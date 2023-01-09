module.exports = (io, socket, db) => {
  const updateUsername = (data) => {
    console.log("trying a name change... in a separate file!");
    socket.data.username = data.name;

    db.serialize(() => {
      var updateUser = `UPDATE users SET username = "${data.name}" WHERE userid = ${data.userid};`;
      db.run(updateUser, function(err) {
        console.log("successful name change");
        io.emit('nameChange', { id: socket.id, name: data.name });
      });
    });
  }

  socket.on('nameChange', updateUsername);
}