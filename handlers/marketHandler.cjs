module.exports = (io, socket, db, market) => {
  const addShareToUserPortfolio = (data) => {
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
  };

  const removeShareFromUserPortfolio = (data) => {
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
  };

  const delistStock = (data) => {
    market.removeStock(data);
    const removeStock = `UPDATE stocks SET censordate = ${Date.now()} WHERE word = "${data}";`;
    db.run(removeStock, (err) => {
      if (err) console.log(err);
      console.log("removing a stock!");
    })
  }

  const updateEmojiReactions = ({ data, state, message, msgID, user }) => {
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
  };

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

  // const resetMarket = () => {

  // }

  socket.on('buyStock', addShareToUserPortfolio);
  socket.on('sellStock', removeShareFromUserPortfolio);
  socket.on('removeStock', delistStock);
  socket.on('updateMarket', updateEmojiReactions);
}