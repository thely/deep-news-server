import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// const localtunnel = require('localtunnel');

const express = require('express');
const cors = require('cors');

const app = express();
const http = require('http').Server(app);

const sqlite3 = require('sqlite3').verbose();
let db;

// if (process.env.ZONE == "DEV") {
//   console.log("making local file db");
//   db = new sqlite3.Database("./data/db.sqlite");
// } else {
//   console.log("making db in memory");
  db = new sqlite3.Database(":memory:");
// }
// var db = new sqlite3.Database(path.resolve('./data/db.sqlite'));
// console.log(path.resolve('./data/db.sqlite'));

db.serialize(function() {
  console.log('creating databases if they don\'t exist');
  // db.run('drop table if exists users');
  // db.run('drop table if exists messages');
  db.run('create table if not exists users (userid integer primary key, socket text, username text not null, funds float default 1000.0, lastlogon integer)');
  db.run('create table if not exists messages (messageid integer primary key, userid integer, username text not null, text text, posted integer)');
  db.run('create table if not exists reacts (messageid integer, userid integer, emoji text)');
  
  // db.run('alter table stocks add column points text');
  // db.run('drop table if exists stocks');
  db.run('create table if not exists stocks (stockid integer primary key, word text, value float, createdate integer, censordate integer, points text)');
  db.run('create table if not exists portfolio (stockid integer, userid integer, count integer)');
});

import StockMarket from "./StockMarketSimulator.js";

var corsOptions = {
  origin: true,
  optionsSuccessStatus: 200
}
app.use(cors(corsOptions));
app.use(express.static('public'));

const io = require('socket.io')(http, {
  cors: {
    origin: process.env.CLIENT_LOC,
    methods: ['GET', 'POST'],
  },
});

app.get('/home', (req, res) => {
  res.send("Hello world.");
})

app.get('/videos', (req, res) => {
  console.log("attempting to read video files");
  const __dirname = path.resolve();
  fs.readdir(path.resolve(__dirname, "public/assets"), (err, files) => {
    if (err) {
      console.log(err);
    }
    else {  
      files = files.filter((vid) => {
        if (vid.includes(".mp4") || vid.includes(".m4v") || vid.includes(".mov")) {
          return true;
        }
      });

      res.json({ videos: files });
    }
  });
});


let msgID = 0;
const stockLimit = 7;
let market = new StockMarket(stockLimit);

const nameList = ["Roland", "Marshall", "Simone", "Jacques", "Jean-Paul", "Hannah", "Angela"];

function randomName() {
  const i = Math.floor(Math.random() * nameList.length);
  return nameList[i];
}

io.on('connection', async (socket) => {
  // get userID if there's something in localstorage
  let userid;
  if ("query" in socket.handshake && "userid" in socket.handshake.query) {
    userid = socket.handshake.query.userid;
  } 

  let sockets;

  try {
    // get all existing sockets
    sockets = await io.fetchSockets();
    sockets = sockets.map((s) => {
      return { id: s.id, data: s.data };
    });

    // tell yourself you exist
    let userinfo = { id: socket.id, isSelf: true, others: sockets, funds: 1000 };

    // callback to send to client about your existence
    function userCallback(data){
      console.log("inside usercallbakc");
      userid = data.userid;
      
      const finalInfo = Object.assign(userinfo, data);
      socket.emit('addUser', finalInfo);
    }

    // on connection: load *everything*
    db.serialize(() => {
      if (userid) {
        var getUser = `SELECT * FROM users WHERE userid = ${userid}`;
        db.get(getUser, function(err, row) {
          // user has an incorrect id in localstorage
          if (err || !row) {
            console.log("you don't exist!");
            buildNewUser(socket, userCallback);
          }
          
          // user exists; get them
          else {
            row.funds = row.funds == null ? 1000 : row.funds;
            const newrow = { userid: row.userid, username: row.username, funds: row.funds };
            userCallback(newrow);
          }
        })
      }
      // user does not exist and no id in localstorage
      else {
        buildNewUser(socket, userCallback);
      }

      // get the user's portfolio
      if (userid && userid != "undefined") {
        console.log("user id is " + userid);
        var getUserPortfolio = `
          SELECT stocks.stockid, userid, stocks.word, count 
          FROM portfolio 
          INNER JOIN stocks ON portfolio.stockid = stocks.stockid
          WHERE userid = ${userid};`;
        db.all(getUserPortfolio, function(err, all) {
          if (err){
            console.log(err);
          }
          else if (all) {
            socket.emit('updateStockPortfolio', all);
          }
        });
      }
    });
  } catch (e) {
    console.log(e);
  }
  
  // tell everyone else you exist
  socket.broadcast.emit('addUser', { id: socket.id, isSelf: false });

  loginMarketData(socket);

  if (!market.marketActive) {
    market.marketActive = true;
    market.stockDayLoop((stocks, state, emojis) => {
      let s = {};
      for (let key of Object.keys(stocks)) {
        s[key] = stocks[key].points.map((e) => e.close);
      }
      
      io.emit("stockUpdateData", { stocks: stocks, state: state, emojis: emojis });
      for (let word of Object.keys(s)) {
        const pts = s[word].join();
        var stockPts = `UPDATE stocks SET points = "${pts}", value = ${s[word][s[word].length - 1]} WHERE word = "${word}";`;
        db.run(stockPts, function(err) {
          if (err) console.log(err);
        });
      }
    });
  }

  // get all existing messages
  var getMessages = `
    SELECT * FROM 
      (SELECT * FROM messages ORDER BY messageid DESC LIMIT ${process.env.MSG_LIMIT}) as messages
      ORDER BY messageid ASC`;
  db.all(getMessages, function(err, msgs) {
    console.log("checking existing messages");
    // console.log(msgs);
    var ids = msgs.map((e) => e.messageid);

    var getEmojis = `SELECT * FROM reacts WHERE messageid IN (${ids.join(",")})`;
    db.all(getEmojis, function(err, emojis) {
      // console.log(emojis);
      if (err) console.log(err);
      else {
        if (emojis && emojis.length > 0) {
          for (let msg of msgs) {
            msg.reactions = emojis.filter((e) => e.messageid == msg.messageid);
          }
        }
        // console.log("about to run messagelist");
        socket.emit('messageList', msgs);
        // console.log("have just run messagelist");
      }
    });
  });


  // -------------------------------------------
  // SOCKET.IO LISTENERS
  // -------------------------------------------

  // Change username
  socket.on('nameChange', (data) => {
    console.log("trying a name change");
    socket.data.username = data.name;

    db.serialize(() => {
      var updateUser = `UPDATE users SET username = "${data.name}" WHERE userid = ${data.userid};`;
      db.run(updateUser, function(err) {
        console.log("successful name change");
        io.emit('nameChange', { id: socket.id, name: data.name });
      });
    });
  });


  // new message entered
  socket.on('message', (data) => {
    console.log('message: ', JSON.stringify(data));

    db.serialize(() => {
      var insertUser = `INSERT INTO messages (userid, username, text, posted) VALUES (${data.userid}, "${data.username}", "${data.msg}", ${Date.now()});`;
      db.run(insertUser, function(err) {
        const msgid = this.lastID;
        console.log(msgid);

        io.emit('message', { user: socket.id, msgID: msgid, text: data.msg, time: new Date().toISOString() });

        // see if you want to add a stock or not
        const stock = market.analyseForStocks(data.msg);
        if (stock) {
          var addStock = `INSERT INTO stocks (word, createdate) VALUES ("${stock}", ${Date.now()})`;
          db.run(addStock, function(err) {
            if (err) {
              console.log(err);
            } else {
              market.addStock(stock);
              io.emit('addStock', {stock: stock, id: this.lastID} );
            }
          });
        }
      });
    });
  });

  socket.on('updateMessage', (data) => {
    socket.broadcast.emit('updateMessage', data);
  });

  socket.on('buyStock', (data) => {
    db.serialize(() => {
      var getUserStock = `select * from portfolio WHERE stockid = ${data.stockid} and userid = ${data.userid}`;
      db.get(getUserStock, function(err, row) {
        // update existing row
        if (row) {
          var updateStock = `UPDATE portfolio SET count = count + 1 WHERE stockid = ${data.stockid} AND userid = ${data.userid}`;
          db.run(updateStock, function(err) {
            if (err) console.log(err);
          });
        }

        // add a new row
        else {
          var addStock = `INSERT INTO portfolio (stockid, userid, count) VALUES (${data.stockid}, ${data.userid}, 1)`;
          db.run(addStock, function(err) {
            if (err) {
              console.log(err);
            }
          });
        }

        market.changeUserShares(data.stock, 1);
        updateUserFunds(data.cost * -1, data.userid);
      });
    });
  });

  socket.on('sellStock', (data) => {
    db.serialize(() => {
      var getUserStock = `SELECT * FROM portfolio WHERE stockid = ${data.stockid} AND userid = ${data.userid}`;
      db.get(getUserStock, function(err, row) {
        console.log(row);
        // update existing row
        if (err) {
          console.log("you... shouldn't have had this stock before!");
        }
        else if (row) {
          // console.log("updating " + data.stock);
          var updateStock = `UPDATE portfolio SET count = count - 1 WHERE stockid = ${data.stockid} AND userid = ${data.userid}`;
          db.run(updateStock, function(err) {
            if (err) console.log(err);

            market.changeUserShares(data.stock, -1);
            updateUserFunds(data.cost, data.userid);
          });
        }
      })
    });
  });

  socket.on('removeStock', (data) => {
    market.removeStock(data);
    const removeStock = `UPDATE stocks SET censordate = ${Date.now()} WHERE word = "${data}";`;
    db.run(removeStock, (err) => {
      if (err) console.log(err);
      console.log("removing a stock!");
    })
  })

  socket.on('updateMarket', ({ data, state, message, msgID, user }) => {
    market.emojiTotals(data, state, message);
    
    db.serialize(() => {
      let sql = `
      SELECT * FROM reacts 
      WHERE 
        emoji = "${data.emoji}" AND
        messageid = ${msgID} AND
        userid = ${user}
      `;

      db.get(sql, function(err, row) {
        if (err) console.log(err);
        else if (row) {
          console.log("exists");
          sql = `
            DELETE from reacts
            WHERE 
              emoji = "${data.emoji}" AND
              messageid = ${msgID} AND
              userid = ${user}
          `;
          db.run(sql, function(err) {
            if (err) console.log(err);
          })
        } else {
          sql = `
            INSERT INTO reacts (messageid, userid, emoji)
            VALUES (${msgID}, ${user}, "${data.emoji}")
          `;

          db.run(sql, function(err) {
            if (err) console.log(err);
          })
        }
      })
    })
  });

  socket.on('disconnect', async () => {
    console.log(`Client disconnected [id=${socket.id}]`);
    io.emit('deleteUser', { id: socket.id });

    try {
      sockets = await io.fetchSockets();
      console.log(sockets.length);
      if (sockets.length <= 0) {
        market.marketActive = false;
      }
    } catch (e) {
      console.log(e);
    }
  });
});

function updateUserFunds(cost, userid) {
  console.log("calling updatefunds?");
  const getFunds = `SELECT funds FROM users WHERE userid = ${userid}`;
  db.get(getFunds, function(err, row) {
    if (row.funds) {
      const changeFunds = `UPDATE users SET funds = funds + ${cost} WHERE userid = ${userid};`;
      db.run(changeFunds, function(err) {
        if (err) console.log(err);
        else console.log("Changed funds for " + userid);
      });
    } else {
      const changeFunds = `UPDATE users SET funds = ${1000 + cost} WHERE userid = ${userid};`;
      db.run(changeFunds, function(err) {
        if (err) console.log(err);
        else console.log("Changed funds for " + userid);
      });
    }
  })
}

function backdateDeadStocks(ids) {
  var updateStocks = `
    UPDATE stocks
    SET censordate = ${Date.now()}
    WHERE stockid NOT IN (${ids.join()}) AND censordate IS NULL
  `;

  db.all(updateStocks, function(err, all) {
    if (err) console.log(err);
    else {
      console.log(all);
    }
  });

  var deadStocks = `SELECT word FROM stocks WHERE censordate IS NOT NULL`;
  db.all(deadStocks, function(err, all) {
    const words = all.map((e) => e.word);
    io.emit("banWords", words);
  });
}

function loginMarketData(socket) {
  var getStocks = `
  SELECT * FROM 
    (SELECT * FROM stocks 
      WHERE censordate IS NULL
      ORDER BY stockid DESC 
      LIMIT ${stockLimit}) 
  ORDER BY stockid ASC`;
  db.all(getStocks, function(err, all) {
    if (err) {
      console.log(err);
    } else if (all.length > 0) {
      socket.emit('updateStockList', all);
      const validIds = all.map((e) => e.stockid);

      startMarket(all, validIds);
      backdateDeadStocks(validIds);
    }
  });
}

function startMarket(stocks, validIds) {
  // const validIds = stocks.map((e) => e.stockid);

  // ------ then, get the share counts for each of those stocks
  var getAllFolio = `
    SELECT stockid, sum(count) as count
    FROM portfolio
    WHERE stockid IN (${validIds.join()})
    GROUP BY stockid`;
  
  db.all(getAllFolio, function(err, shares) {
    if (err){
      console.log(err);
    }
    // ----- attach share numbers back to the stock
    else if (shares) {
      for (let stock of stocks) {
        const mycount = shares.filter(e => e.stockid == stock.stockid);
        if (mycount.length > 0) {
          stock.count = mycount[0].count;
        } 
      }

      market.importAllShares(stocks);
    }
  });
}

function buildNewUser(socket, callback) {
  const n = randomName();
  var insertUser = `INSERT INTO users (socket, username, funds, lastlogon) VALUES ("${socket.id}", "${n}", 1000.0, ${Date.now()});`;
  // let userstuff = {};

  db.run(insertUser, function(err) {
    if (err) {
      console.log(err);
    }
    var userid = this.lastID;
    console.log(userid);

    callback({ userid: userid, username: n });
  });

  // console.log(userstuff);
  // return userstuff;
}


async function writeFile(filename, writedata) {
  try {
    await fs.promises.writeFile(filename, writedata, 'utf8');
    console.log('data is written successfully in the file')
  }
  catch (err) {
    console.log('not able to write data in the file ')
  }
}

// actual server location
http.listen(process.env.PORT, () => {
  console.log(`listening on *:${process.env.PORT}`);
  
  // if (process.env.MODE != "development") {
  //   (async () => {
  //     let tunnel;
  //     try {
  //       tunnel = await localtunnel({ port: 8081 });
  //       await writeFile("./src/config.json", JSON.stringify({url : tunnel.url}));
  //       await writeFile("./OPENME.txt", tunnel.url);
  //       console.log(tunnel.url);
  
  //       // await sendToOther();
        
  //     } catch (e) {
  //       console.log(e);
  //     }
  
  //     tunnel.on('close', () => {
  //       console.log("closing tunnel");
  //     });
  //   })();
  // } else {
    // (async () => {
    //   await writeFile("./src/config.json", JSON.stringify({ url : "http://localhost:8081"}))
    // })();
  // }
});

for (let signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.info(`${signal} signal received.`);
    console.log("Closing http server.");
    http.close((err) => {
      db.close();
      console.log("Http server closed.");
      process.exit(err ? 1 : 0);
    });
  });
}