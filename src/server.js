'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, GameError } = require('./game');
const Tally = require('./tally');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_, res) => res.send('ok'));
app.get('/tally.js', (_, res) => res.sendFile(path.join(__dirname, 'tally.js')));

const rooms = new Map(); // code -> room
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 20) || 'Spelare';

function lobbyView(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    settings: room.settings,
    inGame: !!room.game,
    tally: room.tally,
    ended: room.ended,
    players: room.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, connected: p.sockets.size > 0 })),
  };
}

function broadcast(room) {
  const lobby = lobbyView(room);
  for (const p of room.players) {
    const state = { lobby, you: p.id, game: room.game ? room.game.viewFor(p.id) : null };
    for (const sid of p.sockets) io.to(sid).emit('state', state);
  }
}

function attach(socket, room, player) {
  player.sockets.add(socket.id);
  socket.data.room = room.code;
  socket.data.pid = player.id;
  socket.join(room.code);
  clearTimeout(room.cleanup);
}

io.on('connection', (socket) => {
  const reply = (cb, data) => typeof cb === 'function' && cb(data);
  const ctx = () => {
    const room = rooms.get(socket.data.room);
    const player = room && room.players.find((p) => p.id === socket.data.pid);
    return { room, player };
  };

  socket.on('create', ({ name, token } = {}, cb) => {
    const code = newCode();
    const room = { code, hostId: null, settings: { maxPlayers: 6, multiplier: 2 }, players: [], game: null, tally: Tally.create(), ended: false };
    rooms.set(code, room);
    const player = { id: crypto.randomUUID(), token: String(token || crypto.randomUUID()), name: cleanName(name), ready: false, sockets: new Set() };
    room.players.push(player);
    room.hostId = player.id;
    attach(socket, room, player);
    reply(cb, { ok: true, code, token: player.token });
    broadcast(room);
  });

  socket.on('join', ({ code, name, token } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return reply(cb, { ok: false, error: 'Hittar inget rum med den koden.' });
    let player = token && room.players.find((p) => p.token === String(token));
    if (!player) {
      if (room.game) return reply(cb, { ok: false, error: 'Spelet har redan börjat i det rummet.' });
      if (room.players.length >= room.settings.maxPlayers) return reply(cb, { ok: false, error: 'Rummet är fullt.' });
      player = { id: crypto.randomUUID(), token: String(token || crypto.randomUUID()), name: cleanName(name), ready: false, sockets: new Set() };
      room.players.push(player);
    } else if (name && !room.game) player.name = cleanName(name);
    attach(socket, room, player);
    reply(cb, { ok: true, code: room.code, token: player.token });
    broadcast(room);
  });

  socket.on('ready', (ready) => {
    const { room, player } = ctx();
    if (!room || room.game) return;
    player.ready = !!ready;
    broadcast(room);
  });

  socket.on('settings', (s = {}, cb) => {
    const { room, player } = ctx();
    if (!room || room.game || room.hostId !== player.id) return reply(cb, { ok: false, error: 'Endast värden kan ändra inställningar.' });
    const maxPlayers = Math.round(Number(s.maxPlayers));
    const multiplier = Math.round(Number(s.multiplier));
    if (maxPlayers >= 2 && maxPlayers <= 6) room.settings.maxPlayers = Math.max(maxPlayers, room.players.length);
    if (multiplier >= 1 && multiplier <= 100) room.settings.multiplier = multiplier;
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('start', (_, cb) => {
    const { room, player } = ctx();
    if (!room || room.hostId !== player.id) return reply(cb, { ok: false, error: 'Endast värden kan starta spelet.' });
    if (room.game && room.game.phase !== 'finished') return reply(cb, { ok: false, error: 'Spelet pågår redan.' });
    if (room.players.length < 2) return reply(cb, { ok: false, error: 'Det behövs minst två spelare.' });
    if (!room.game && room.players.some((p) => !p.ready && p.id !== room.hostId))
      return reply(cb, { ok: false, error: 'Alla spelare är inte redo än.' });
    room.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name })), { multiplier: room.settings.multiplier });
    reply(cb, { ok: true });
    broadcast(room);
  });

  // Avsluta: visa slutskärmen med ställningen för alla.
  socket.on('endSession', () => {
    const { room, player } = ctx();
    if (!room || room.hostId !== player.id || (room.game && room.game.phase !== 'finished')) return;
    room.ended = true;
    broadcast(room);
  });

  // Stäng slutskärmen: nollställ poängtavlan och gå tillbaka till rummet.
  socket.on('closeSession', () => {
    const { room, player } = ctx();
    if (!room || room.hostId !== player.id || !room.ended) return;
    room.ended = false;
    room.tally = Tally.create();
    room.game = null;
    room.players.forEach((p) => { p.ready = false; });
    broadcast(room);
  });


  socket.on('leave', () => {
    const { room, player } = ctx();
    if (!room) return;
    socket.leave(room.code);
    player.sockets.delete(socket.id);
    socket.data.room = null;
    if (!room.game) {
      room.players = room.players.filter((p) => p !== player);
      if (room.hostId === player.id && room.players[0]) room.hostId = room.players[0].id;
      if (room.players.length === 0) rooms.delete(room.code);
    }
    broadcast(room);
  });

  // Alla drag går hit. Node kör en händelse i taget, så två drag kan aldrig ske samtidigt.
  socket.on('action', (a, cb) => {
    const { room, player } = ctx();
    if (!room || !room.game) return reply(cb, { ok: false, error: 'Inget spel pågår.' });
    try {
      room.game.act(player.id, a);
      if (room.game.phase === 'finished' && !room.game.tallied) { room.game.tallied = true; Tally.addRound(room.tally, room.game.results); }
      reply(cb, { ok: true });
      broadcast(room);
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      reply(cb, { ok: false, error: e instanceof GameError ? e.message : 'Något gick fel på servern.' });
    }
  });

  socket.on('disconnect', () => {
    const { room, player } = ctx();
    if (!room || !player) return;
    player.sockets.delete(socket.id);
    broadcast(room);
    if (room.players.every((p) => p.sockets.size === 0)) {
      room.cleanup = setTimeout(() => rooms.delete(room.code), 1000 * 60 * 60 * 6);
    }
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => console.log(`Gursch körs på http://localhost:${PORT}`));
module.exports = { server, rooms };
