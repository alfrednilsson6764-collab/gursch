'use strict';
// Mynt, kistor och kortlekar (Alfred 2026-11-09). Delas av servern, klienten (gäster) och testversionen.
// Inloggade: servern räknar mynt och drar slumpen i kistorna. Gäster: samma regler, men sparat i localStorage.
// Mynt kan bara tjänas genom att spela – de går aldrig att köpa för riktiga pengar.
(function (root) {
  const RARITIES = {
    common: { name: 'Vanlig', color: '#a7b0b8', chance: 0.60, rank: 0 },
    rare: { name: 'Sällsynt', color: '#3d9bff', chance: 0.30, rank: 1 },
    epic: { name: 'Episk', color: '#b05cff', chance: 0.09, rank: 2 },
    legendary: { name: 'Legendarisk', color: '#f5c542', chance: 0.01, rank: 3 },
  };
  const DECKS = [
    { id: 'classic', name: 'Klassisk grön', rarity: 'common', starter: true },
    { id: 'navy', name: 'Marinblå', rarity: 'common' },
    { id: 'wine', name: 'Vinröd', rarity: 'common' },
    { id: 'graphite', name: 'Grafit', rarity: 'common' },
    { id: 'neon', name: 'Neon', rarity: 'rare' },
    { id: 'ice', name: 'Is', rarity: 'rare' },
    { id: 'wood', name: 'Trä', rarity: 'rare' },
    { id: 'retro', name: 'Retro 80-tal', rarity: 'rare' },
    { id: 'space', name: 'Rymd', rarity: 'epic' },
    { id: 'lava', name: 'Lava', rarity: 'epic' },
    { id: 'marble', name: 'Marmor', rarity: 'epic' },
    { id: 'gold', name: 'Ren guld', rarity: 'legendary' },
  ];
  const STARTER = 'classic';
  const CHEST_COST = 100;
  const DUPLICATE_REFUND = 30;
  const PITY = 10; // efter 10 kistor utan Episk eller bättre blir nästa minst Episk
  const GUEST_IMPORT_MAX_COINS = 300;
  const GUEST_IMPORT_RARITIES = ['common', 'rare'];

  const deckById = (id) => DECKS.find((d) => d.id === id) || null;
  const isDeck = (id) => !!deckById(id);

  /** Mynt för en avslutad omgång: 10 för att ha spelat klart, +10 vid vinst, +5 om man inte förlorade.
   *  Mot bara bottar blir det hälften. (Vinst ger alltså 20, mitten 15 och förlust 10.) */
  function roundCoins(result, { botsOnly = false } = {}) {
    let c = 10;
    if (result.winner) c += 10;
    else if (!result.loser) c += 5;
    return botsOnly ? Math.round(c / 2) : c;
  }

  /** Drar en kista. owned: id:n man redan har. pity: antal kistor i rad utan Episk eller bättre.
   *  rand: funktion som ger [0, 1). Returnerar { deckId, rarity, duplicate, refund, pity }. */
  function rollChest(owned, pity, rand = Math.random) {
    const has = new Set(owned || []);
    const forced = (pity || 0) >= PITY;
    const pool = forced ? ['epic', 'legendary'] : Object.keys(RARITIES);
    const total = pool.reduce((s, r) => s + RARITIES[r].chance, 0);
    let x = rand() * total, rarity = pool[pool.length - 1];
    for (const r of pool) { if (x < RARITIES[r].chance) { rarity = r; break; } x -= RARITIES[r].chance; }
    const decks = DECKS.filter((d) => d.rarity === rarity && !d.starter);
    const deck = decks[Math.min(decks.length - 1, Math.floor(rand() * decks.length))];
    const duplicate = has.has(deck.id);
    return { deckId: deck.id, rarity, duplicate, refund: duplicate ? DUPLICATE_REFUND : 0, pity: RARITIES[rarity].rank >= 2 ? 0 : (pity || 0) + 1 };
  }

  /** Vad en gäst får ta med sig till sitt nya konto. */
  function guestImport(wallet) {
    const coins = Math.max(0, Math.min(GUEST_IMPORT_MAX_COINS, Math.floor(Number(wallet && wallet.coins) || 0)));
    const decks = [...new Set((wallet && Array.isArray(wallet.decks) ? wallet.decks : []).map(String))]
      .filter((id) => { const d = deckById(id); return d && !d.starter && GUEST_IMPORT_RARITIES.includes(d.rarity); });
    return { coins, decks };
  }

  const api = { RARITIES, DECKS, STARTER, CHEST_COST, DUPLICATE_REFUND, PITY, GUEST_IMPORT_MAX_COINS, deckById, isDeck, roundCoins, rollChest, guestImport };
  if (typeof module !== 'undefined') module.exports = api;
  else root.GurschEconomy = api;
})(typeof window !== 'undefined' ? window : globalThis);
