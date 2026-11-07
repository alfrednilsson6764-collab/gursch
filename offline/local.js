'use strict';
// Ersätter servern i testversionen: spelmotorn och bottarna körs direkt i webbläsaren.
window.GURSCH_LOCAL = function () {
  const { Game, GameError } = window.GurschGame;
  const { botMove } = window.GurschBots;
  const Tally = window.GurschTally;
  const BOT_NAMES = ['Astrid (bot)', 'Bertil (bot)', 'Cissi (bot)', 'David (bot)', 'Elsa (bot)'];
  const BOT_DELAY = 900;
  const handlers = {};
  let room = null, botTimer = null, holdTimer = null;

  const fire = (ev, d) => (handlers[ev] || []).forEach((f) => f(d));
  const reply = (cb, d) => typeof cb === 'function' && cb(d);

  function syncBots() {
    const n = room.settings.maxPlayers;
    room.players = [room.players[0], ...BOT_NAMES.slice(0, n - 1).map((name, k) => ({ id: 'bot' + k, name, ready: true, bot: true }))];
  }
  function lobbyView() {
    const g = room.game;
    if (g && g.phase === 'finished' && !g.tallied) { g.tallied = true; Tally.addRound(room.tally, g.results); }
    return { code: 'TEST', hostId: 'me', settings: room.settings, inGame: !!room.game, tally: room.tally, ended: !!room.ended,
      players: room.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, connected: true })) };
  }
  function broadcast() {
    if (!room) return;
    fire('state', { lobby: lobbyView(), you: 'me', game: room.game ? room.game.viewFor('me') : null });
    scheduleBots();
  }
  function scheduleBots() {
    clearTimeout(botTimer);
    const g = room && room.game;
    if (!g || g.phase === 'finished' || room.hold) return; // vänta tills utdelningen har visats
    for (const p of room.players.filter((x) => x.bot)) {
      const move = botMove(g, p.id);
      if (!move) continue;
      botTimer = setTimeout(() => {
        try { g.act(p.id, move); } catch (e) { console.error('Botfel', p.name, move, e); return; }
        broadcast();
      }, BOT_DELAY);
      return;
    }
  }

  function handle(ev, data, cb) {
    switch (ev) {
      case 'create':
        room = { settings: { maxPlayers: 4, multiplier: 2 }, game: null, tally: Tally.create(), ended: false,
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
        syncBots(); reply(cb, { ok: true }); return broadcast();
      }
      case 'start':
        room.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name })), { multiplier: room.settings.multiplier });
        room.hold = true;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => { if (room) { room.hold = false; scheduleBots(); } }, 30000);
        reply(cb, { ok: true }); return broadcast();
      case 'action':
        try { room.game.act('me', data); reply(cb, { ok: true }); }
        catch (e) { reply(cb, { ok: false, error: e instanceof GameError ? e.message : 'Något gick fel.' }); if (!(e instanceof GameError)) console.error(e); }
        return broadcast();
      case 'animDone':
        if (room) { room.hold = false; clearTimeout(holdTimer); scheduleBots(); }
        return;
      case 'endSession':
        room.ended = true; return broadcast();
      case 'closeSession':
        room.ended = false; room.tally = Tally.create(); room.game = null; return broadcast();
      case 'toLobby':
        room.game = null; return broadcast();
      case 'leave':
        clearTimeout(botTimer); room = null; return;
      default:
    }
  }

  return {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); if (ev === 'connect') setTimeout(fn, 0); },
    emit(ev, data, cb) { setTimeout(() => handle(ev, data, cb), 0); },
  };
};
