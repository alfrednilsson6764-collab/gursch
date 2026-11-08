'use strict';
// Ersätter servern i testversionen: spelmotorn och bottarna körs direkt i webbläsaren.
window.GURSCH_LOCAL = function () {
  const { Game, GameError } = window.GurschGame;
  const { botMove, BOT_PROFILES, CHATTINESS } = window.GurschBots;
  const Tally = window.GurschTally;
  const { timeoutMove, createTurnTimers, createPersuadeTimer } = window.GurschTimer;
  const Reactions = window.GurschReactions;
  const me = {}; // för spamskyddet
  function botsReact() {
    const g = room && room.game; if (!g) return;
    const bots = room.players.filter((p) => p.bot);
    const chat = Object.fromEntries(bots.map((b) => [b.id, CHATTINESS[b.personality] ?? 1]));
    const { reactions, seq } = Reactions.botReactions(g, room.reactSeq || 0, bots.map((b) => b.id), Math.random, chat);
    room.reactSeq = seq;
    reactions.forEach((r, k) => setTimeout(() => {
      const bot = room && room.players.find((p) => p.id === r.playerId);
      if (bot && Reactions.allow(bot, r.emoji)) fire('reaction', { playerId: bot.id, emoji: r.emoji });
    }, 500 + k * 700));
  }
  const timers = createTurnTimers((pid) => {
    const g = room && room.game; if (!g) return;
    const move = timeoutMove(g, pid); if (!move) return;
    try { g.act(pid, move); } catch (e) { console.error('Timerfel', e); }
    broadcast();
  });
  const persuade = createPersuadeTimer((proposalId) => {
    const g = room && room.game; if (!g) return;
    if (g.persuadeExpired(proposalId)) broadcast();
  });
  const BOT_NAMES = BOT_PROFILES.map((b) => b.name + ' (bot)');
  const BOT_DELAY = { slow: 1600, normal: 900, fast: 400 };
  const handlers = {};
  let room = null, botTimer = null, holdTimer = null;

  const fire = (ev, d) => (handlers[ev] || []).forEach((f) => f(d));
  const reply = (cb, d) => typeof cb === 'function' && cb(d);

  function syncBots() {
    const n = room.settings.maxPlayers;
    room.players = [room.players[0], ...BOT_PROFILES.slice(0, n - 1).map((b, k) => ({ id: 'bot' + k, name: b.name + ' (bot)', personality: b.personality, ready: true, bot: true }))];
  }
  function lobbyView() {
    const g = room.game;
    if (g && g.phase === 'finished' && !g.tallied) { g.tallied = true; Tally.addRound(room.tally, g.results); }
    return { code: 'TEST', local: true, hostId: 'me', settings: room.settings, inGame: !!room.game, tally: room.tally, ended: !!room.ended, timers: timers.remaining(), persuadeLeft: persuade.remaining(),
      players: room.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, bot: !!p.bot, personality: p.personality, connected: true })) };
  }
  function broadcast() {
    if (!room) return;
    timers.sync(room.game, ['me'], room.settings.turnTime, room.hold);
    persuade.sync(room.game);
    botsReact();
    fire('state', { lobby: lobbyView(), you: 'me', game: room.game ? room.game.viewFor('me') : null });
    scheduleBots();
  }
  function scheduleBots() {
    clearTimeout(botTimer);
    const g = room && room.game;
    if (!g || g.phase === 'finished' || room.hold) return; // vänta tills utdelningen har visats
    for (const p of room.players.filter((x) => x.bot)) {
      const move = botMove(g, p.id, p.personality);
      if (!move || move.type === 'exchangeGo') continue; // "Vi kör" lämnas åt människan
      botTimer = setTimeout(() => {
        try { g.act(p.id, move); } catch (e) { console.error('Botfel', p.name, move, e); return; }
        broadcast();
      }, move.delay || BOT_DELAY[room.settings.botSpeed] || BOT_DELAY.normal);
      return;
    }
  }

  function handle(ev, data, cb) {
    switch (ev) {
      case 'create':
        room = { settings: { maxPlayers: 4, multiplier: 2, botSpeed: 'normal', extraExchanges: true, persuade: false, turnTime: 0 }, game: null, tally: Tally.create(), ended: false,
          players: [{ id: 'me', name: (data && data.name) || 'Du', ready: true }] };
        syncBots();
        reply(cb, { ok: true, code: 'TEST', token: 'local' });
        return broadcast();
      case 'join':
        return reply(cb, { ok: false, error: 'I testversionen spelar du mot bottar – tryck på Skapa spel.' });
      case 'settings': {
        const m = Math.round(Number(data.maxPlayers)), x = Math.round(Number(data.multiplier));
        if (m >= 2 && m <= 6) room.settings.maxPlayers = m;
        if (x >= 1 && x <= 100) room.settings.multiplier = x;
        if (data.botSpeed in BOT_DELAY) room.settings.botSpeed = data.botSpeed;
        if (typeof data.extraExchanges === 'boolean') room.settings.extraExchanges = data.extraExchanges;
        if (typeof data.persuade === 'boolean') room.settings.persuade = data.persuade;
        if (data.multiplier === 'highest' || data.multiplier === 'second') room.settings.multiplier = data.multiplier;
        if ([0, 20, 30, 60].includes(Number(data.turnTime))) room.settings.turnTime = Number(data.turnTime);
        syncBots(); reply(cb, { ok: true }); return broadcast();
      }
      case 'start':
        room.reactSeq = 0;
        room.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name })), { multiplier: room.settings.multiplier, extraExchanges: room.settings.extraExchanges, persuade: !!room.settings.persuade });
        room.hold = true;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => { if (room) { room.hold = false; broadcast(); } }, 30000);
        reply(cb, { ok: true }); return broadcast();
      case 'action':
        try { room.game.act('me', data); reply(cb, { ok: true }); }
        catch (e) { reply(cb, { ok: false, error: e instanceof GameError ? e.message : 'Något gick fel.' }); if (!(e instanceof GameError)) console.error(e); }
        return broadcast();
      case 'animDone':
        if (room) { room.hold = false; clearTimeout(holdTimer); broadcast(); }
        return;
      case 'react':
        if (room && Reactions.allow(me, String(data))) fire('reaction', { playerId: 'me', emoji: String(data) });
        return;
      case 'endSession':
        room.ended = true; return broadcast();
      case 'closeSession':
        room.ended = false; room.tally = Tally.create(); room.game = null; return broadcast();
      case 'leave':
        clearTimeout(botTimer); timers.clearAll(); persuade.clear(); room = null; return;
      default:
    }
  }

  return {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); if (ev === 'connect') setTimeout(fn, 0); },
    emit(ev, data, cb) { setTimeout(() => handle(ev, data, cb), 0); },
  };
};
