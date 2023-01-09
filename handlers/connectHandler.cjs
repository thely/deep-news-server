module.exports = async (io, socket, db, market, stockLimit) => {

  const userConnect = async () => {
    let userid;
    // get userid out of localstorage, if applicable
    if ("query" in socket.handshake && "userid" in socket.handshake.query) {
      userid = socket.handshake.query.userid;
    } 
  
    let sockets;
  
    try {
      // get all existing sockets
      sockets = await io.fetchSockets();
    } catch (e) {
      console.log(e);
    }
  
    sockets = sockets.map((s) => {
      return { id: s.id, data: s.data };
    });
  
    // tell yourself you exist
    let userinfo = { id: socket.id, isSelf: true, others: sockets, funds: 1000 };
    socket.isIdle = false;
  
    // callback to send to client about your existence
    function userCallback(data){
      console.log("inside usercallbakc");
      userid = data.userid;
      
      const finalInfo = Object.assign(userinfo, data);
      socket.emit('addUser', finalInfo);
    }
  
    // on connection: load all data for the user
    db.serialize(() => {
      getUserIfExists(socket, userid, userCallback);
  
      // get the user's stock portfolio
      if (userid && userid != "undefined") {
        getUserPortfolio(socket, userid);
      }
    });
    
    
    // tell everyone else you exist
    socket.broadcast.emit('addUser', { id: socket.id, isSelf: false });
  
    getCurrentMarketState(socket);
  
    if (!market.marketActive) {
      startMarket();
    }
  
    // get all existing messages
    getAllMessages(socket);
  }

  // socket.on('disconnect', async () => {
  const userDisconnect = async () => {
    console.log(`Client disconnected [id=${socket.id}]`);
    io.emit('deleteUser', { id: socket.id });

    try {
      sockets = await io.fetchSockets();
      console.log(sockets.length);
      if (sockets.length <= 0) {
        dumpTables();
        // market.marketActive = false;
      }
    } catch (e) {
      console.log(e);
    }
  }

  // is this user idling or not?
  const updateUserActivity = async (data) => {
    console.log("inside updateuser, do something new??");

    let sockets = await io.fetchSockets();
    const prevState = socket.isIdle;
    socket.isIdle = data.state;
    sockets = sockets.map((s) => {
      return { id: s.id, isIdle: s.isIdle };
    });

    let idleCount = 0;

    for (let socket of sockets) {
      idleCount += socket.isIdle ? 1 : 0;
    }
    
    // basically kill the db
    if (idleCount == sockets.length) {
      console.log("we need to reset everything!");
      dumpTables();
      io.emit("resetAll");
    } else if (!data.state && prevState) {
      console.log("user woke up again. we need to get the world rolling again");
      userConnect();
    }
  }

  const dumpTables = () => {
    market.marketActive = false;
    db.serialize(function() {
      try {
        db.run("DELETE FROM reacts");
        db.run("DELETE FROM messages");
        db.run("DELETE FROM stocks");
        db.run("DELETE FROM portfolio");
        db.run("DELETE FROM users");
      } catch (e) {
        console.log(e);
      }
    });
  }


  userConnect();
  socket.on("disconnect", userDisconnect);
  socket.on('idleUser', updateUserActivity);


  // ---------------------------
  // various login functions
  // ---------------------------
  const nameList = ["Roland", "Marshall", "Simone", "Jacques", "Jean-Paul", "Hannah", "Angela"];

  function randomName() {
    const i = Math.floor(Math.random() * nameList.length);
    return nameList[i];
  }

  // check if localstorage id matches an actual user.
  // if yes, return them; if no, create them
  function getUserIfExists(socket, userid, callback) {
    if (userid) {
      var getUser = `SELECT * FROM users WHERE userid = ${userid}`;
      db.get(getUser, function(err, row) {
        // user has an incorrect id in localstorage
        if (err || !row) {
          console.log("you don't exist!");
          buildNewUser(socket, callback);
        }
        
        // user exists; get them
        else {
          row.funds = row.funds == null ? 1000 : row.funds;
          const newrow = { userid: row.userid, username: row.username, funds: row.funds };
          callback(newrow);
        }
      })
    }
    // user does not exist and no id in localstorage
    else {
      buildNewUser(socket, callback);
    }
  }

  // create new user and add to db
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
  }

  // get stock portfolio for userid
  function getUserPortfolio(socket, userid) {
    console.log("user id is " + userid);
    var getUserPortfolioQuery = `
      SELECT stocks.stockid, userid, stocks.word, count 
      FROM portfolio 
      INNER JOIN stocks ON portfolio.stockid = stocks.stockid
      WHERE userid = ${userid};`;
    db.all(getUserPortfolioQuery, function(err, all) {
      if (err){
        console.log(err);
      }
      else if (all) {
        socket.emit('updateStockPortfolio', all);
      }
    });
  }

  // get most recent 12 messages
  function getAllMessages(socket) {
    var getMessages = `
      SELECT * FROM 
        (SELECT * FROM messages ORDER BY messageid DESC LIMIT ${process.env.MSG_LIMIT}) as messages
        ORDER BY messageid ASC`;
    db.all(getMessages, function(err, msgs) {
      console.log("checking existing messages");
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
  }

  // using valid ids, get active market info and
  // inform users on live/dead stocks
  function getCurrentMarketState(socket) {
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

        getActiveShares(all, validIds);
        backdateDeadStocks(validIds);
      }
    });
  }

  // retroactively backdate any stocks that weren't
  // in the list of provided stock ids; ban them, inform users
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


  // get share counts for all active stocks,
  // to inform market
  function getActiveShares(stocks, validIds) {
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


  // callback to update users on every day of the stock loop
  function startMarket() {
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
}