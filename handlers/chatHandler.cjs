require('dotenv').config();

module.exports = (io, socket, db, market) => {

  const addNewMessage = (data) => {
    var msg = data.msg.replace(/["]/giu, '\"\"');

    db.serialize(() => {
      var insertUser = `INSERT INTO messages (userid, username, text, posted) VALUES (${data.userid}, "${data.username}", "${msg}", ${Date.now()});`;
      db.run(insertUser, function(err) {
        if (err) {
          console.log(err);
        }
        
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
  }

  socket.on('message', addNewMessage);
  socket.on('updateMessage', (data) => {
    socket.broadcast.emit('updateMessage', data);
  });
}