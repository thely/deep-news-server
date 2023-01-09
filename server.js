import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();

// basic express setup
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const app = express();
const http = require('http').Server(app);

var corsOptions = {
  origin: true,
  optionsSuccessStatus: 200
}
app.use(cors(corsOptions));
app.use(express.static('public'));

// database
const sqlite3 = require('sqlite3').verbose();
let db = new sqlite3.Database(":memory:");

// var db = new sqlite3.Database(path.resolve('./data/db.sqlite'));
// console.log(path.resolve('./data/db.sqlite'));

db.serialize(function() {
  console.log('creating databases if they don\'t exist');
  // db.run('drop table if exists users');
  // db.run('drop table if exists messages');
  db.run('create table if not exists users (userid integer primary key, socket text, username text not null, funds float default 1000.0, lastlogon integer, isidle integer)');
  db.run('create table if not exists messages (messageid integer primary key, userid integer, username text not null, text text, posted integer)');
  db.run('create table if not exists reacts (messageid integer, userid integer, emoji text)');
  
  // db.run('alter table stocks add column points text');
  // db.run('drop table if exists stocks');
  db.run('create table if not exists stocks (stockid integer primary key, word text, value float, createdate integer, censordate integer, points text)');
  db.run('create table if not exists portfolio (stockid integer, userid integer, count integer)');
});


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

import StockMarket from "./StockMarketSimulator.js";

const { default: registerConnectHandler } = await import("./handlers/connectHandler.cjs");
const { default: registerUserHandler } = await import("./handlers/userHandler.cjs");
const { default: registerChatHandler } = await import("./handlers/chatHandler.cjs");
const { default: registerMarketHandler } = await import("./handlers/marketHandler.cjs");


let msgID = 0;
const stockLimit = 7;
let market = new StockMarket(stockLimit);


io.on('connection', async (socket) => {
  registerConnectHandler(io, socket, db, market, stockLimit);
  registerUserHandler(io, socket, db);
  registerChatHandler(io, socket, db, market);
  registerMarketHandler(io, socket, db, market);
});


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
});

for (let signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    console.info(`${signal} signal received.`);
    console.log("Closing http server.");

    const sockets = await io.fetchSockets();
    for (let socket of sockets) {
      socket.disconnect(true);
    }

    http.close((err) => {
      io.close();
      db.close();
      console.log("Http server closed.");
      process.exit(err ? 1 : 0);
    });
  });
}