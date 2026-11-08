'use strict';
// Turtimer för Gursch (Alfred 2026-11-08). Används av servern (och av testversionen i webbläsaren).
// Ändrar inga spelregler: när tiden går ut görs ett vanligt drag åt spelaren.
(function (root) {
  const { botMove } = typeof module !== 'undefined' ? require('./bots') : root.GurschBots;

  /** Draget som görs när tiden har gått ut. Under bytet är standardvalet "behåll"/"nej". null = spelaren behöver inte göra något. */
  function timeoutMove(game, pid) {
    const ex = game.exchange;
    // Extra byte: den som ska svara och inte hinner räknas som nej (då startar övertalningsfristen).
    // Är ingen fråga ute och ingen gör något blir det "Vi kör".
    if (game.phase === 'exchange' && ex && ex.step === 'extra') {
      if (!ex.proposal) return { type: 'exchangeGo' };
      return ex.proposal.votes[pid] === null ? { type: 'exchangeVote', yes: false } : null;
    }
    const move = botMove(game, pid);
    if (!move) return null;
    if (game.phase === 'exchange' && ex) {
      if (ex.step === 'leader') return { type: 'exchangeLeader', cardIds: [] };
      if (ex.step === 'others') return { type: 'exchangeOther', discard: false };
      if (ex.step === 'replace') return { type: 'exchangeReplace', keep: true };
    }
    return move; // spelet och extra slängning (som alla redan sagt ja till): samma logik som bottarna
  }

  /** En nyckel som ändras när ett nytt beslut ska fattas, så att timern startar om bara då. */
  function turnKey(game) {
    const ex = game.exchange, pl = game.play;
    if (ex) return `x${ex.round}:${ex.step}:${ex.proposal ? ex.proposal.id : ''}:${Object.keys(ex.offers).join(',')}`;
    if (pl) return `p${pl.roundNo}:${pl.table.length}:${pl.turn}`;
    return game.phase;
  }

  /**
   * Håller en timer per människa vars tur det är.
   * sync(game, humanIds, seconds, paused) anropas efter varje ändring; onExpire(pid) anropas när tiden är slut.
   */
  function createTurnTimers(onExpire) {
    const timers = new Map(); // pid -> { key, deadline, handle }
    const clear = (pid) => { const t = timers.get(pid); if (t) clearTimeout(t.handle); timers.delete(pid); };
    return {
      sync(game, humanIds, seconds, paused) {
        const active = new Set();
        if (game && seconds > 0 && !paused && game.phase !== 'finished') {
          const key = turnKey(game);
          for (const pid of humanIds) {
            if (!timeoutMove(game, pid)) continue;
            active.add(pid);
            const t = timers.get(pid);
            if (t && t.key === key) continue;
            clear(pid);
            const deadline = Date.now() + seconds * 1000;
            timers.set(pid, { key, deadline, handle: setTimeout(() => { timers.delete(pid); onExpire(pid); }, seconds * 1000) });
          }
        }
        for (const pid of [...timers.keys()]) if (!active.has(pid)) clear(pid);
      },
      /** Kvarvarande millisekunder per spelare. */
      remaining() {
        const now = Date.now(), out = {};
        for (const [pid, t] of timers) out[pid] = Math.max(0, t.deadline - now);
        return out;
      },
      clearAll() { for (const pid of [...timers.keys()]) clear(pid); },
    };
  }

  /**
   * Övertalningsfristen vid extra byte: när någon har sagt nej får de andra PERSUADE_SECONDS på sig.
   * sync(game, scale) anropas efter varje ändring; onExpire(proposalId) när tiden är ute.
   */
  function createPersuadeTimer(onExpire, seconds = 10) {
    let cur = null; // { id, deadline, handle }
    const clear = () => { if (cur) clearTimeout(cur.handle); cur = null; };
    return {
      sync(game, scale = 1) {
        const ex = game && game.phase === 'exchange' && game.exchange, P = ex && ex.proposal;
        if (!P || !P.persuading) return clear();
        if (cur && cur.id === P.id) return;
        clear();
        const ms = seconds * 1000 * scale, id = P.id;
        cur = { id, deadline: Date.now() + ms, handle: setTimeout(() => { cur = null; onExpire(id); }, ms) };
      },
      /** Kvarvarande millisekunder (eller null om ingen frist pågår). */
      remaining() { return cur ? Math.max(0, cur.deadline - Date.now()) : null; },
      clear,
    };
  }

  const api = { timeoutMove, turnKey, createTurnTimers, createPersuadeTimer };
  if (typeof module !== 'undefined') module.exports = api;
  else root.GurschTimer = api;
})(typeof window !== 'undefined' ? window : globalThis);
