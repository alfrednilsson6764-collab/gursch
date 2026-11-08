'use strict';
// Snabbreaktioner i Gursch (Alfred 2026-11-08). Delas av servern och testversionen.
(function (root) {
  const REACTIONS = ['😂', '🔥', '😤', '👏', '😱', '🙏'];
  const COOLDOWN_MS = 2000; // högst en reaktion per 2 sekunder och spelare

  /** Ska en reaktion släppas igenom? Uppdaterar spelarens senaste tid. Tyst nej för spam och okända emojis. */
  function allow(player, emoji, now = Date.now()) {
    if (!REACTIONS.includes(emoji)) return false;
    if (player.lastReact && now - player.lastReact < COOLDOWN_MS) return false;
    player.lastReact = now;
    return true;
  }

  /**
   * Bottar reagerar ibland på det som hänt sedan förra gången:
   * 👏 eller 😤 när någon tar styret, 😂 när de vinner en omgång. Bara ibland, så att det inte blir tjatigt.
   * chattiness per bot ändrar hur ofta (Bertil är högljudd, Astrid reagerar sällan).
   * Returnerar { reactions: [{ playerId, emoji }], seq }.
   */
  function botReactions(game, sinceSeq, botIds, rnd = Math.random, chattiness = {}) {
    const c = (id) => (chattiness[id] == null ? 1 : chattiness[id]); // personlighet: högljudd > 1, tystlåten < 1
    const out = [];
    if (!game || !botIds.length) return { reactions: out, seq: sinceSeq };
    let seq = sinceSeq;
    for (const ev of game.events) {
      if (ev.seq <= sinceSeq) continue;
      seq = Math.max(seq, ev.seq);
      if (ev.type === 'leader' && ev.reason === 'beat') {
        const others = botIds.filter((id) => id !== ev.playerId);
        if (!others.length) continue;
        const who = others[Math.floor(rnd() * others.length)];
        if (rnd() < Math.min(0.9, 0.2 * c(who))) out.push({ playerId: who, emoji: rnd() < 0.5 ? '👏' : '😤' });
      }
    }
    if (game.phase === 'finished' && !game.botsCheered) {
      game.botsCheered = true;
      for (const r of game.results || []) if (r.winner && botIds.includes(r.playerId) && rnd() < Math.min(1, 0.6 * c(r.playerId))) out.push({ playerId: r.playerId, emoji: '😂' });
    }
    return { reactions: out, seq };
  }

  const api = { REACTIONS, COOLDOWN_MS, allow, botReactions };
  if (typeof module !== 'undefined') module.exports = api;
  else root.GurschReactions = api;
})(typeof window !== 'undefined' ? window : globalThis);
