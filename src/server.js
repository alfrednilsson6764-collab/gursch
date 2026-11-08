'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, GameError } = require('./game');
const { botMove } = require('./bots');
const { timeoutMove, createTurnTimers } = require('./turntimer');
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
const BOT_NAMES = ['Astrid', 'Bertil', 'Cissi', 'David', 'Elsa'];
const BOT_DELAY = { slow: 1600, normal: 900, fast: 400 };
const TURN_TIMES = [0, 20, 30, 60]; // sekunder per drag, 0 = av
const DEFAULT_SETTINGS = () => ({ maxPlayers: 6, multiplier: 2, botSpeed: 'normal', extraExchanges: true, turnTime: 0, visibility: 'private' });
const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 20) || 'Spelare';

function lobbyView(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    settings: room.settings,
    inGame: !!room.game,
    tally: room.tally,
    ended: room.ended,
    timers: room.timers ? room.timers.remaining() : {},
    players: room.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, bot: !!p.bot, connected: !!p.bot || p.sockets.size > 0 })),
  };
}

function broadcast(room) {
  syncTimers(room);
  const lobby = lobbyView(room);
  for (const p of room.players) {
    const state = { lobby, you: p.id, game: room.game ? room.game.viewFor(p.id) : null };
    for (const sid of p.sockets) io.to(sid).emit('state', state);
  }
  scheduleBots(room);
  pushOpenRooms();
}

// ---------- turtimer: servern äger timern ----------
function syncTimers(room) {
  if (!room.timers) {
    room.timers = createTurnTimers((pid) => {
      const g = room.game;
      if (!g || !rooms.has(room.code)) return;
      const move = timeoutMove(g, pid);
      if (!move) return;
      try { applyAction(room, pid, move); } catch (e) { console.error('Timerfel', move, e); }
      broadcast(room);
    });
  }
  // gäller alla människor, även de som tappat anslutningen, så att spelet inte fastnar
  room.timers.sync(room.game, humans(room).map((p) => p.id), room.settings.turnTime * (Number(process.env.GURSCH_TIME_SCALE) || 1), room.hold);
}

// ---------- öppna rum ----------
let lastOpen = '';
function openRoomsList() {
  return [...rooms.values()]
    .filter((r) => r.settings.visibility === 'open' && !r.game && r.players.length < r.settings.maxPlayers && humans(r).some((p) => p.sockets.size > 0))
    .map((r) => ({ code: r.code, host: (r.players.find((p) => p.id === r.hostId) || {}).name || '', players: r.players.length, max: r.settings.maxPlayers }));
}
function pushOpenRooms() {
  const list = openRoomsList(), json = JSON.stringify(list);
  if (json === lastOpen) return;
  lastOpen = json;
  io.emit('openRooms', list);
}
function closeRoom(room) {
  clearTimeout(room.botTimer); clearTimeout(room.holdTimer);
  if (room.timers) room.timers.clearAll();
  rooms.delete(room.code);
  pushOpenRooms();
}

// Kör ett drag (från en människa eller en bot) och för in resultatet i poängtavlan.
function applyAction(room, pid, a) {
  room.game.act(pid, a);
  if (room.game.phase === 'finished' && !room.game.tallied) { room.game.tallied = true; Tally.addRound(room.tally, room.game.results); }
}

// Bottarna gör ett drag i taget med en kort paus, så att människorna hinner se vad som händer.
function scheduleBots(room) {
  clearTimeout(room.botTimer);
  const g = room.game;
  if (!g || g.phase === 'finished' || room.hold || !rooms.has(room.code)) return;
  for (const p of room.players.filter((x) => x.bot)) {
    const move = botMove(g, p.id);
    if (!move) continue;
    room.botTimer = setTimeout(() => {
      if (room.game !== g) return;
      try { applyAction(room, p.id, move); } catch (e) { console.error('Botfel', p.name, move, e); return; }
      broadcast(room);
    }, Number(process.env.GURSCH_BOT_DELAY) || BOT_DELAY[room.settings.botSpeed] || BOT_DELAY.normal);
    return;
  }
}
const humans = (room) => room.players.filter((p) => !p.bot);

function attach(socket, room, player) {
  player.sockets.add(socket.id);
  socket.data.room = room.code;
  socket.data.pid = player.id;
  socket.join(room.code);
  clearTimeout(room.cleanup);
}

io.on('connection', (socket) => {
  socket.emit('openRooms', openRoomsList());
  const reply = (cb, data) => typeof cb === 'function' && cb(data);
  const ctx = () => {
    const room = rooms.get(socket.data.room);
    const player = room && room.players.find((p) => p.id === socket.data.pid);
    return { room, player };
  };

  socket.on('create', ({ name, token } = {}, cb) => {
    const code = newCode();
    const room = { code, hostId: null, settings: DEFAULT_SETTINGS(), players: [], game: null, tally: Tally.create(), ended: false };
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
    if (s.botSpeed in BOT_DELAY) room.settings.botSpeed = s.botSpeed;
    if (s.multiplier === 'highest' || s.multiplier === 'second') room.settings.multiplier = s.multiplier;
    if (typeof s.extraExchanges === 'boolean') room.settings.extraExchanges = s.extraExchanges;
    if (TURN_TIMES.includes(Number(s.turnTime))) room.settings.turnTime = Number(s.turnTime);
    if (s.visibility === 'open' || s.visibility === 'private') room.settings.visibility = s.visibility;
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
    room.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name })),
      { multiplier: room.settings.multiplier, extraExchanges: room.settings.extraExchanges });
    // Bottarna väntar tills utdelningen har visats (eller högst 30 sekunder).
    // Bottar och turtimer väntar tills utdelningen har visats (eller högst 30 sekunder).
    room.hold = true;
    clearTimeout(room.holdTimer);
    room.holdTimer = setTimeout(() => { room.hold = false; broadcast(room); }, 30000);
    reply(cb, { ok: true });
    broadcast(room);
  });

  // Värden lägger till eller tar bort en bot i rummet.
  socket.on('addBot', (_, cb) => {
    const { room, player } = ctx();
    if (!room || room.game || room.hostId !== player.id) return reply(cb, { ok: false, error: 'Endast värden kan lägga till bottar.' });
    if (room.players.length >= room.settings.maxPlayers) return reply(cb, { ok: false, error: 'Rummet är fullt. Höj antalet spelare först.' });
    const taken = new Set(room.players.map((p) => p.name));
    const name = (BOT_NAMES.find((n) => !taken.has(n + ' (bot)')) || 'Bot ' + room.players.length) + ' (bot)';
    room.players.push({ id: 'bot-' + crypto.randomUUID(), token: crypto.randomUUID(), name, ready: true, bot: true, sockets: new Set() });
    reply(cb, { ok: true });
    broadcast(room);
  });
  socket.on('removeBot', (id, cb) => {
    const { room, player } = ctx();
    if (!room || room.game || room.hostId !== player.id) return reply(cb, { ok: false, error: 'Endast värden kan ta bort bottar.' });
    room.players = room.players.filter((p) => !(p.bot && p.id === id));
    reply(cb, { ok: true });
    broadcast(room);
  });

  // Utdelningen har visats hos en spelare – då får bottarna börja.
  socket.on('animDone', () => {
    const { room } = ctx();
    if (!room || !room.hold) return;
    room.hold = false;
    clearTimeout(room.holdTimer);
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
      if (room.hostId === player.id && humans(room)[0]) room.hostId = humans(room)[0].id;
      if (humans(room).length === 0) closeRoom(room);
    }
    broadcast(room);
  });

  // Alla drag går hit. Node kör en händelse i taget, så två drag kan aldrig ske samtidigt.
  socket.on('action', (a, cb) => {
    const { room, player } = ctx();
    if (!room || !room.game) return reply(cb, { ok: false, error: 'Inget spel pågår.' });
    try {
      applyAction(room, player.id, a);
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
      room.cleanup = setTimeout(() => closeRoom(room), 1000 * 60 * 60 * 6);
    }
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => console.log(`Gursch körs på http://localhost:${PORT}`));
module.exports = { server, rooms };
