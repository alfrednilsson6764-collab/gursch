'use strict';
// Konton via Supabase (Alfred 2026-11-09). Inga extra bibliotek: vi pratar direkt med Supabase REST-API:er.
//  - Auth: verifiera användarens access-token (GET /auth/v1/user) och radera konton (admin-API).
//  - Databas: tabellerna i db/schema.sql via PostgREST (/rest/v1), alltid med den hemliga nyckeln.
// Utan miljövariablerna är inloggning avstängd och alla spelar som gäster, precis som förut.
const { validateUsername } = require('./usernames');

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
    await call('/rest/v1/owned_decks', { method: 'POST', body: { user_id: id, deck_id: 'classic' }, prefer: 'return=minimal,resolution=ignore-duplicates' });
    return r.data[0];
  }

  /** Räknar en spelad omgång (och vinst) för en inloggad spelare. */
  async function recordGame(id, won) {
    const p = await getProfile(id);
    if (!p) return;
    await call(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { games_played: p.games_played + 1, wins: p.wins + (won ? 1 : 0) }, prefer: 'return=minimal' });
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

  return { enabled, verify, getProfile, getCollection, createProfile, recordGame, deleteAccount, keepAlive,
    config: () => (enabled ? { auth: true, supabaseUrl: url, publishableKey } : { auth: false }) };
}

module.exports = { createAccounts, AccountError };
