'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Game, GameError } = require('./game');
const { botMove, BOT_PROFILES, CHATTINESS } = require('./bots');
const { timeoutMove, createTurnTimers, createPersuadeTimer } = require('./turntimer');
const Reactions = require('./reactions');
const Tally = require('./tally');
const { createAccounts, AccountError } = require('./accounts');

// Inloggning (valfritt): sätt de här tre i Render → Environment. Saknas de spelar alla som gäster.
// Äldre namn (anon/service_role) godtas också. Värdena trimmas så att ett mellanslag vid inklistring inte stoppar inloggningen.
const env = (...names) => { for (const n of names) { const v = (process.env[n] || '').trim(); if (v) return v; } return ''; };
const accounts = createAccounts({
  url: env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
  publishableKey: env('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  secretKey: env('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'),
});
if (require.main === module) {
  const missing = [['SUPABASE_URL', env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL')], ['SUPABASE_PUBLISHABLE_KEY', accounts.config().publishableKey || env('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_KEY')], ['SUPABASE_SECRET_KEY', env('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY')]].filter(([, v]) => !v).map(([n]) => n);
  console.log(accounts.enabled ? 'Inloggning: PÅ (Supabase)' : `Inloggning: AV – saknar ${missing.join(', ')}. Alla spelar som gäster.`);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_, res) => res.send('ok'));
// Klienten hämtar Supabase-adress och publik nyckel här (den hemliga nyckeln lämnar aldrig servern).
app.get('/config', (_, res) => res.json(accounts.config()));
app.get('/integritet', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'integritet.html')));
app.get('/usernames.js', (_, res) => res.sendFile(path.join(__dirname, 'usernames.js')));
// Håll Supabase-projektet vaket: en enkel fråga en gång per dygn (gratisprojekt pausas annars efter en vecka).
if (accounts.enabled && require.main === module) {
  const ping = () => accounts.keepAlive().then((ok) => console.log('Supabase keepalive', ok ? 'ok' : 'misslyckades')).catch((e) => console.error('Supabase keepalive', e.message));
  setTimeout(ping, 60 * 1000).unref();
  setInterval(ping, 24 * 60 * 60 * 1000).unref();
}
app.get('/tally.js', (_, res) => res.sendFile(path.join(__dirname, 'tally.js')));
app.get('/bots.js', (_, res) => res.sendFile(path.join(__dirname, 'bots.js')));

const rooms = new Map(); // code -> room
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const BOT_NAMES = BOT_PROFILES.map((b) => b.name); // Astrid, Bertil, Cissi, David, Elsa – en personlighet var
const BOT_DELAY = { slow: 1600, normal: 900, fast: 400 };
const TURN_TIMES = [0, 20, 30, 60]; // sekunder per drag, 0 = av
const DEFAULT_SETTINGS = () => ({ maxPlayers: 6, multiplier: 2, botSpeed: 'normal', extraExchanges: true, persuade: false, turnTime: 0, visibility: 'private' });
// Inloggade spelare heter alltid sitt användarnamn; gäster väljer namn själva.
const nameFor = (socket, n) => (socket.data.profile ? socket.data.profile.username : cleanName(n));
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
    persuadeLeft: room.persuade ? room.persuade.remaining() : null,
    players: room.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, bot: !!p.bot, personality: p.personality, connected: !!p.bot || p.sockets.size > 0 })),
    spectators: (room.spectators || []).map((p) => ({ id: p.id, name: p.name, wantsJoin: !!p.wantsJoin, connected: p.sockets.size > 0 })),
  };
}

function broadcast(room) {
  syncTimers(room);
  const lobby = lobbyView(room);
  for (const p of room.players) {
    const state = { lobby, you: p.id, game: room.game ? room.game.viewFor(p.id) : null };
    for (const sid of p.sockets) io.to(sid).emit('state', state);
  }
  // Åskådare får samma vy som någon utanför spelet: inga dolda kort, ingen egen hand.
  if (room.spectators && room.spectators.length) {
    const game = room.game ? room.game.viewFor(null) : null;
    for (const p of room.spectators) {
      const state = { lobby, you: p.id, spectator: true, game };
      for (const sid of p.sockets) io.to(sid).emit('state', state);
    }
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
  // övertalningsfristen vid extra byte (10 sekunder efter att någon sagt nej)
  if (!room.persuade) {
    room.persuade = createPersuadeTimer((proposalId) => {
      const g = room.game;
      if (!g || !rooms.has(room.code)) return;
      if (g.persuadeExpired(proposalId)) broadcast(room);
    });
  }
  room.persuade.sync(room.game, Number(process.env.GURSCH_TIME_SCALE) || 1);
}

// ---------- öppna rum ----------
let lastOpen = '';
function openRoomsList() {
  return [...rooms.values()]
    .filter((r) => r.settings.visibility === 'open' && humans(r).some((p) => p.sockets.size > 0))
    .map((r) => ({ code: r.code, host: (r.players.find((p) => p.id === r.hostId) || {}).name || '', players: r.players.length, max: r.settings.maxPlayers,
      playing: !!r.game, full: r.players.length >= r.settings.maxPlayers, watchers: (r.spectators || []).length }));
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
  if (room.persuade) room.persuade.clear();
  rooms.delete(room.code);
  pushOpenRooms();
}

// Kör ett drag (från en människa eller en bot) och för in resultatet i poängtavlan.
function applyAction(room, pid, a) {
  room.game.act(pid, a);
  if (room.game.phase === 'finished' && !room.game.tallied) {
    room.game.tallied = true;
    Tally.addRound(room.tally, room.game.results);
    // statistik för inloggade spelare (gäster och bottar räknas inte)
    for (const r of room.game.results) {
      const p = room.players.find((x) => x.id === r.playerId);
      if (p && p.userId) accounts.recordGame(p.userId, !!r.winner).catch((e) => console.error('Statistik', e.message));
    }
  }
  botsReact(room);
}

// ---------- snabbreaktioner ----------
function sendReaction(room, player, emoji) {
  if (!Reactions.allow(player, emoji)) return false; // fel emoji eller spam: ignoreras tyst
  io.to(room.code).emit('reaction', { playerId: player.id, emoji });
  return true;
}
function botsReact(room) {
  const g = room.game, bots = room.players.filter((p) => p.bot);
  if (!g || !bots.length) return;
  const chat = Object.fromEntries(bots.map((b) => [b.id, CHATTINESS[b.personality] ?? 1]));
  const { reactions, seq } = Reactions.botReactions(g, room.reactSeq || 0, bots.map((b) => b.id), Math.random, chat);
  room.reactSeq = seq;
  reactions.forEach((r, k) => setTimeout(() => {
    const bot = room.players.find((p) => p.id === r.playerId);
    if (bot && rooms.has(room.code)) sendReaction(room, bot, r.emoji);
  }, 500 + k * 700));
}

// Bottarna gör ett drag i taget med en kort paus, så att människorna hinner se vad som händer.
function scheduleBots(room) {
  clearTimeout(room.botTimer);
  const g = room.game;
  if (!g || g.phase === 'finished' || room.hold || !rooms.has(room.code)) return;
  for (const p of room.players.filter((x) => x.bot)) {
    const move = botMove(g, p.id, p.personality);
    if (!move) continue;
    // "Vi kör" avslutar bytena för alla – det får bara bottarna trycka när de spelar själva
    if (move.type === 'exchangeGo' && humans(room).length) continue;
    room.botTimer = setTimeout(() => {
      if (room.game !== g) return;
      try { applyAction(room, p.id, move); } catch (e) { console.error('Botfel', p.name, move, e); return; }
      broadcast(room);
    }, botDelay(room, move));
    return;
  }
}
const MAX_SPECTATORS = 20;
const humans = (room) => room.players.filter((p) => !p.bot);
// Vanlig paus mellan botdrag; vissa drag (t.ex. att låta sig övertalas) väntar längre så att man hinner tjata.
function botDelay(room, move) {
  if (Number(process.env.GURSCH_BOT_DELAY)) return Number(process.env.GURSCH_BOT_DELAY);
  return move.delay || BOT_DELAY[room.settings.botSpeed] || BOT_DELAY.normal;
}

function attach(socket, room, player) {
  player.sockets.add(socket.id);
  socket.data.room = room.code;
  socket.data.pid = player.id;
  socket.join(room.code);
  clearTimeout(room.cleanup);
}

// Inloggning: klienten skickar sin access-token när den ansluter; servern verifierar den hos Supabase.
// Ogiltig eller utgången token → man ansluter som gäst (klienten förnyar token och ansluter igen).
io.use(async (socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (token && accounts.enabled) {
    try {
      const user = await accounts.verify(String(token));
      if (user) { socket.data.user = user; socket.data.profile = await accounts.getProfile(user.id); }
      else socket.data.badToken = true;
    } catch (e) { console.error('Inloggning', e.message); socket.data.badToken = true; }
  }
  next();
});
const accountState = (socket) => ({
  enabled: accounts.enabled,
  loggedIn: !!socket.data.user,
  badToken: !!socket.data.badToken,
  email: socket.data.user ? socket.data.user.email : null,
  profile: socket.data.profile || null,
  needsUsername: !!socket.data.user && !socket.data.profile,
});

io.on('connection', (socket) => {
  socket.emit('openRooms', openRoomsList());
  socket.emit('account', accountState(socket));
  const reply = (cb, data) => typeof cb === 'function' && cb(data);
  const ctx = () => {
    const room = rooms.get(socket.data.room);
    const player = room && room.players.find((p) => p.id === socket.data.pid);
    // åskådare räknas inte som spelare: de kan inte göra drag, ändra inställningar osv.
    return player ? { room, player } : { room: null, player: null };
  };

  socket.on('create', ({ name, token } = {}, cb) => {
    const code = newCode();
    const room = { code, hostId: null, settings: DEFAULT_SETTINGS(), players: [], spectators: [], game: null, tally: Tally.create(), ended: false };
    rooms.set(code, room);
    const player = { id: crypto.randomUUID(), token: String(token || crypto.randomUUID()), name: nameFor(socket, name), userId: socket.data.profile ? socket.data.profile.id : null, ready: false, sockets: new Set() };
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
    // återanslutning som åskådare
    const spec = !player && token && room.spectators.find((p) => p.token === String(token));
    if (spec) {
      attach(socket, room, spec);
      reply(cb, { ok: true, code: room.code, token: spec.token, spectator: true });
      return broadcast(room);
    }
    if (!player) {
      if (room.game) return reply(cb, { ok: false, canWatch: true, error: 'Spelet har redan börjat i det rummet – du kan titta på.' });
      if (room.players.length >= room.settings.maxPlayers) return reply(cb, { ok: false, canWatch: true, error: 'Rummet är fullt – du kan titta på.' });
      player = { id: crypto.randomUUID(), token: String(token || crypto.randomUUID()), name: nameFor(socket, name), userId: socket.data.profile ? socket.data.profile.id : null, ready: false, sockets: new Set() };
      room.players.push(player);
    } else if ((name || socket.data.profile) && !room.game) player.name = nameFor(socket, name);
    attach(socket, room, player);
    reply(cb, { ok: true, code: room.code, token: player.token });
    broadcast(room);
  });

  // ---------- konto ----------
  // Första inloggningen: välj ett unikt användarnamn.
  socket.on('setUsername', async (username, cb) => {
    if (!socket.data.user) return reply(cb, { ok: false, error: 'Du är inte inloggad.' });
    if (socket.data.profile) return reply(cb, { ok: false, error: 'Du har redan ett användarnamn.' });
    try {
      socket.data.profile = await accounts.createProfile(socket.data.user.id, username);
      reply(cb, { ok: true, account: accountState(socket) });
    } catch (e) {
      if (!(e instanceof AccountError)) console.error(e);
      reply(cb, { ok: false, error: e instanceof AccountError ? e.message : 'Något gick fel.' });
    }
  });
  socket.on('getProfile', async (_, cb) => {
    if (!socket.data.profile) return reply(cb, { ok: false, error: 'Du är inte inloggad.' });
    try {
      socket.data.profile = await accounts.getProfile(socket.data.user.id) || socket.data.profile;
      const decks = await accounts.getCollection(socket.data.user.id);
      reply(cb, { ok: true, profile: socket.data.profile, decks, email: socket.data.user.email });
    } catch (e) { reply(cb, { ok: false, error: e instanceof AccountError ? e.message : 'Något gick fel.' }); }
  });
  // Radera mitt konto: profil, samling och inloggning tas bort hos Supabase.
  socket.on('deleteAccount', async (_, cb) => {
    if (!socket.data.user) return reply(cb, { ok: false, error: 'Du är inte inloggad.' });
    try {
      await accounts.deleteAccount(socket.data.user.id);
      socket.data.user = null; socket.data.profile = null;
      reply(cb, { ok: true });
    } catch (e) {
      if (!(e instanceof AccountError)) console.error(e);
      reply(cb, { ok: false, error: e instanceof AccountError ? e.message : 'Något gick fel.' });
    }
  });

  // ---------- åskådare ----------
  // Titta på ett rum (pågående match eller fullt rum). Åskådare ser inga dolda kort.
  socket.on('watch', ({ code, name, token } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return reply(cb, { ok: false, error: 'Hittar inget rum med den koden.' });
    if (token && room.players.some((p) => p.token === String(token))) return reply(cb, { ok: false, error: 'Du är redan med i rummet.' });
    let spec = token && room.spectators.find((p) => p.token === String(token));
    if (!spec) {
      if (room.spectators.length >= MAX_SPECTATORS) return reply(cb, { ok: false, error: 'Det är fullt med åskådare.' });
      spec = { id: 'spec-' + crypto.randomUUID(), token: crypto.randomUUID(), name: nameFor(socket, name), userId: socket.data.profile ? socket.data.profile.id : null, wantsJoin: false, sockets: new Set() };
      room.spectators.push(spec);
    }
    attach(socket, room, spec);
    reply(cb, { ok: true, code: room.code, token: spec.token, spectator: true });
    broadcast(room);
  });
  const specCtx = () => {
    const room = rooms.get(socket.data.room);
    return { room, spec: room && room.spectators.find((p) => p.id === socket.data.pid) };
  };
  // När omgången är klar (eller innan spelet börjat) kan en åskådare be om att få gå med.
  socket.on('askJoin', (_, cb) => {
    const { room, spec } = specCtx();
    if (!spec) return reply(cb, { ok: false, error: 'Du tittar inte på något rum.' });
    if (room.game && room.game.phase !== 'finished') return reply(cb, { ok: false, error: 'Vänta tills omgången är klar.' });
    spec.wantsJoin = true;
    reply(cb, { ok: true });
    broadcast(room);
  });
  socket.on('cancelJoin', () => {
    const { room, spec } = specCtx();
    if (!spec) return;
    spec.wantsJoin = false;
    broadcast(room);
  });
  // Värden svarar på en förfrågan. Ja: åskådaren blir spelare i nästa omgång.
  socket.on('answerJoin', ({ id, accept } = {}, cb) => {
    const { room, player } = ctx();
    if (!room || !player || room.hostId !== player.id) return reply(cb, { ok: false, error: 'Endast värden kan svara.' });
    const spec = room.spectators.find((p) => p.id === id && p.wantsJoin);
    if (!spec) return reply(cb, { ok: false, error: 'Förfrågan finns inte längre.' });
    if (!accept) {
      spec.wantsJoin = false;
      for (const sid of spec.sockets) io.to(sid).emit('joinAnswer', { accepted: false });
      reply(cb, { ok: true });
      return broadcast(room);
    }
    if (room.game && room.game.phase !== 'finished') return reply(cb, { ok: false, error: 'Vänta tills omgången är klar.' });
    if (room.players.length >= 6) return reply(cb, { ok: false, error: 'Rummet är fullt (högst 6 spelare).' });
    room.settings.maxPlayers = Math.max(room.settings.maxPlayers, room.players.length + 1);
    room.spectators = room.spectators.filter((p) => p !== spec);
    room.players.push({ id: spec.id, token: spec.token, name: spec.name, userId: spec.userId || null, ready: true, sockets: spec.sockets });
    for (const sid of spec.sockets) io.to(sid).emit('joinAnswer', { accepted: true });
    reply(cb, { ok: true });
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
    if (typeof s.persuade === 'boolean') room.settings.persuade = s.persuade;
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
    room.reactSeq = 0;
    room.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name })),
      { multiplier: room.settings.multiplier, extraExchanges: room.settings.extraExchanges, persuade: !!room.settings.persuade });
    // Bottarna väntar tills utdelningen har visats (eller högst 30 sekunder).
    // Bottar och turtimer väntar tills utdelningen har visats (eller högst 30 sekunder).
    room.hold = true;
    clearTimeout(room.holdTimer);
    room.holdTimer = setTimeout(() => { room.hold = false; broadcast(room); }, 30000);
    reply(cb, { ok: true });
    broadcast(room);
  });

  // Värden lägger till eller tar bort en bot i rummet.
  // Värden väljer vilken bot (personlighet) som ska läggas till; utan val tas första lediga.
  socket.on('addBot', (choice, cb) => {
    const { room, player } = ctx();
    if (!room || room.game || room.hostId !== player.id) return reply(cb, { ok: false, error: 'Endast värden kan lägga till bottar.' });
    if (room.players.length >= room.settings.maxPlayers) return reply(cb, { ok: false, error: 'Rummet är fullt. Höj antalet spelare först.' });
    const taken = new Set(room.players.filter((p) => p.bot).map((p) => p.name));
    const wanted = choice && typeof choice === 'object' ? String(choice.name || '') : '';
    const profile = BOT_PROFILES.find((b) => b.name === wanted && !taken.has(b.name + ' (bot)')) || (!wanted && BOT_PROFILES.find((b) => !taken.has(b.name + ' (bot)')));
    if (!profile) return reply(cb, { ok: false, error: wanted ? 'Den boten är redan med.' : 'Alla bottar är redan med.' });
    room.players.push({ id: 'bot-' + crypto.randomUUID(), token: crypto.randomUUID(), name: profile.name + ' (bot)', personality: profile.personality,
      ready: true, bot: true, sockets: new Set() });
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

  // Värden kickar en spelare (människa eller bot) från lobbyn innan spelet har börjat.
  socket.on('kick', (id, cb) => {
    const { room, player } = ctx();
    if (!room || room.hostId !== player.id) return reply(cb, { ok: false, error: 'Endast värden kan ta bort spelare.' });
    if (room.game) return reply(cb, { ok: false, error: 'Det går inte att ta bort spelare under ett spel.' });
    const target = room.players.find((p) => p.id === id);
    if (!target || target.id === player.id) return reply(cb, { ok: false, error: 'Den spelaren finns inte.' });
    room.players = room.players.filter((p) => p !== target);
    for (const sid of target.sockets || []) {
      const s = io.sockets.sockets.get(sid);
      if (s) { s.leave(room.code); s.data.room = null; s.emit('kicked', { code: room.code }); }
    }
    reply(cb, { ok: true });
    broadcast(room);
  });

  // Snabbreaktion: bara emojis från den fasta listan, högst en per 2 sekunder och spelare.
  socket.on('react', (emoji) => {
    const { room, player } = ctx();
    if (!room || !player) return;
    sendReaction(room, player, String(emoji));
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
    const { room: sroom, spec } = specCtx();
    if (spec) {
      socket.leave(sroom.code);
      socket.data.room = null;
      sroom.spectators = sroom.spectators.filter((p) => p !== spec);
      return broadcast(sroom);
    }
    const { room, player } = ctx();
    if (!room || !player) return;
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
    const { room: sroom, spec } = specCtx();
    if (spec) { spec.sockets.delete(socket.id); return broadcast(sroom); }
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
module.exports = { server, rooms, accounts };
