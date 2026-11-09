'use strict';
// Konton via Supabase (Alfred 2026-11-09). Inga extra bibliotek: vi pratar direkt med Supabase REST-API:er.
//  - Auth: verifiera användarens access-token (GET /auth/v1/user) och radera konton (admin-API).
//  - Databas: tabellerna i db/schema.sql via PostgREST (/rest/v1), alltid med den hemliga nyckeln.
// Utan miljövariablerna är inloggning avstängd och alla spelar som gäster, precis som förut.
const { validateUsername } = require('./usernames');
const Eco = require('./economy');
const crypto = require('crypto');

class AccountError extends Error {}

function createAccounts({ url, publishableKey, secretKey, fetchImpl = globalThis.fetch } = {}) {
  url = String(url || '').replace(/\/+$/, '');
  const enabled = !!(url && publishableKey && secretKey);
  const cache = new Map(); // token -> { user, until }

  async function call(path, { method = 'GET', body, key = secretKey, token, prefer } = {}) {
    const headers = { apikey: key, Authorization: `Bearer ${token || key}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await fetchImpl(url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  }

  /** Verifierar en access-token hos Supabase. Returnerar { id, email } eller null. Cachas en kort stund. */
  async function verify(token) {
    if (!enabled || !token) return null;
    const hit = cache.get(token);
    if (hit && hit.until > Date.now()) return hit.user;
    const r = await call('/auth/v1/user', { key: publishableKey, token });
    const user = r.ok && r.data && r.data.id ? { id: r.data.id, email: r.data.email || null } : null;
    cache.set(token, { user, until: Date.now() + (user ? 5 : 1) * 60 * 1000 });
    if (cache.size > 5000) cache.clear();
    return user;
  }

  async function getProfile(id) {
    const r = await call(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=*`);
    if (!r.ok) throw new AccountError('Kunde inte läsa profilen.');
    return (r.data && r.data[0]) || null;
  }

  async function getCollection(id) {
    const r = await call(`/rest/v1/owned_decks?user_id=eq.${encodeURIComponent(id)}&select=deck_id,unlocked_at&order=unlocked_at`);
    if (!r.ok) throw new AccountError('Kunde inte läsa samlingen.');
    return r.data || [];
  }

  /** Skapar profilen vid första inloggningen. Användarnamnet kontrolleras och måste vara unikt. */
  async function createProfile(id, raw) {
    const v = validateUsername(raw);
    if (!v.ok) throw new AccountError(v.error);
    const r = await call('/rest/v1/profiles', { method: 'POST', body: { id, username: v.username }, prefer: 'return=representation' });
    if (r.status === 409 || (r.data && r.data.code === '23505')) {
      const existing = await getProfile(id);
      if (existing) return existing; // profilen fanns redan (t.ex. två flikar)
      throw new AccountError('Användarnamnet är upptaget – välj ett annat.');
    }
    if (!r.ok) throw new AccountError('Kunde inte spara användarnamnet.');
    await addDeck(id, Eco.STARTER);
    return r.data[0];
  }

  /** Ändrar profilen säkert: läser, räknar ut ändringen och skriver bara om ingen annan hunnit ändra emellan
   *  (filter på mynt, kistor och omgångar). Försöker igen några gånger. change(p) returnerar fälten som ska ändras. */
  async function updateProfile(id, change) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const p = await getProfile(id);
      if (!p) throw new AccountError('Profilen finns inte.');
      const patch = await change(p);
      if (!patch) return { profile: p };
      const guard = `id=eq.${encodeURIComponent(id)}&coins=eq.${p.coins}&chests_opened=eq.${p.chests_opened}&games_played=eq.${p.games_played}`;
      const r = await call(`/rest/v1/profiles?${guard}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
      if (!r.ok) throw new AccountError('Kunde inte spara.');
      if (Array.isArray(r.data) && r.data[0]) return { profile: r.data[0], before: p };
    }
    throw new AccountError('Försök igen om en stund.');
  }

  async function addDeck(id, deckId) {
    const r = await call('/rest/v1/owned_decks', { method: 'POST', body: { user_id: id, deck_id: deckId }, prefer: 'return=minimal,resolution=ignore-duplicates' });
    if (!r.ok && r.status !== 409) throw new AccountError('Kunde inte spara kortleken.');
  }

  /** Räknar en spelad omgång (och vinst) och ger mynten för den. */
  async function recordGame(id, won, coins = 0) {
    const { profile } = await updateProfile(id, (p) => ({ games_played: p.games_played + 1, wins: p.wins + (won ? 1 : 0), coins: p.coins + Math.max(0, coins | 0) }));
    return profile;
  }

  /** Öppnar en kista: servern drar slumpen, drar av mynten och sparar leken. */
  async function openChest(id) {
    const owned = (await getCollection(id)).map((d) => d.deck_id);
    let roll = null;
    const { profile } = await updateProfile(id, (p) => {
      if (p.coins < Eco.CHEST_COST) throw new AccountError(`Du behöver ${Eco.CHEST_COST} 🪙 för att öppna en kista.`);
      roll = Eco.rollChest(owned, p.pity_counter, () => crypto.randomInt(1e9) / 1e9);
      return { coins: p.coins - Eco.CHEST_COST + roll.refund, chests_opened: p.chests_opened + 1, pity_counter: roll.pity };
    });
    if (!roll.duplicate) await addDeck(id, roll.deckId);
    return { roll, profile };
  }

  /** Väljer vilken av ens egna kortlekar man spelar med. */
  async function selectDeck(id, deckId) {
    const owned = (await getCollection(id)).map((d) => d.deck_id);
    if (!Eco.isDeck(deckId) || !owned.includes(deckId)) throw new AccountError('Den kortleken har du inte låst upp än.');
    const r = await call(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { selected_deck: deckId }, prefer: 'return=representation' });
    if (!r.ok || !r.data || !r.data[0]) throw new AccountError('Kunde inte välja kortleken.');
    return r.data[0];
  }

  /** Flyttar en gästs mynt och lekar till ett helt nytt konto (högst 300 mynt, bara Vanliga och Sällsynta lekar). */
  async function importGuest(id, wallet) {
    const want = Eco.guestImport(wallet);
    const owned = (await getCollection(id)).map((d) => d.deck_id);
    const fresh = (p) => p.coins === 0 && p.games_played === 0 && p.chests_opened === 0 && owned.every((d) => d === Eco.STARTER);
    const { profile } = await updateProfile(id, (p) => {
      if (!fresh(p)) throw new AccountError('Gästmynt kan bara flyttas till ett nytt konto.');
      return want.coins ? { coins: want.coins } : null;
    });
    for (const d of want.decks) await addDeck(id, d);
    return { profile, imported: want };
  }

  /** Raderar allt: profilen, samlingen och själva inloggningen (e-post) hos Supabase. */
  async function deleteAccount(id) {
    await call(`/rest/v1/owned_decks?user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
    await call(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
    const r = await call(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new AccountError('Kunde inte radera kontot hos Supabase.');
    for (const [t, c] of cache) if (c.user && c.user.id === id) cache.delete(t);
  }

  /** En enkel fråga så att Supabase-projektet inte pausas av inaktivitet. */
  async function keepAlive() {
    if (!enabled) return false;
    const r = await call('/rest/v1/profiles?select=id&limit=1');
    return r.ok;
  }

  return { enabled, verify, getProfile, getCollection, createProfile, recordGame, openChest, selectDeck, importGuest, deleteAccount, keepAlive,
    config: () => (enabled ? { auth: true, supabaseUrl: url, publishableKey } : { auth: false }) };
}

module.exports = { createAccounts, AccountError };
