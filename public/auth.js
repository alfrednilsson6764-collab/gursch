'use strict';
// Inloggning med Supabase (Alfred 2026-11-09): e-postlänk (magic link) och Google.
// Inga bibliotek – vi använder Supabase Auth-API:t direkt. Sessionen sparas i localStorage.
// Spelservern får access-token när Socket.IO ansluter och verifierar den själv.
(function () {
  const KEY = 'gursch.session';
  let cfg = null; // { auth, supabaseUrl, publishableKey }
  let session = null; // { access_token, refresh_token, expires_at }
  const listeners = [];
  const changed = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

  try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
  const save = (s) => { session = s; try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} };

  // Tillbaka från e-postlänken eller Google: token ligger i adressens #-del.
  let hashError = null;
  if (location.hash.length > 1) {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('access_token')) {
      save({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'),
        expires_at: Number(h.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(h.get('expires_in') || 3600) });
      try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    } else if (h.get('error_description') || h.get('error')) {
      hashError = (h.get('error_description') || h.get('error')).replace(/\+/g, ' ');
      try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    }
  }

  const api = (path, opts = {}) => fetch(cfg.supabaseUrl + path, {
    ...opts, headers: { apikey: cfg.publishableKey, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const expired = () => !session || !session.expires_at || session.expires_at * 1000 < Date.now() + 60 * 1000;

  async function refresh() {
    if (!cfg || !cfg.auth || !session || !session.refresh_token) return false;
    try {
      const r = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) });
      if (!r.ok) { if (r.status >= 400 && r.status < 500) save(null); return false; }
      const d = await r.json();
      save({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
      return true;
    } catch { return false; }
  }
  // förnya i god tid innan token går ut, och anslut då på nytt
  setInterval(async () => { if (session && expired() && await refresh()) changed(); }, 60 * 1000);

  const redirectTo = () => location.origin + location.pathname;

  window.GurschAuth = {
    hashError: () => hashError,
    token: () => (session ? session.access_token : null),
    loggedIn: () => !!session,
    enabled: () => !!(cfg && cfg.auth),
    onChange: (f) => listeners.push(f),
    /** Hämtar /config. Returnerar true om inloggning finns på servern. */
    async init() {
      try { cfg = await (await fetch('/config')).json(); } catch { cfg = { auth: false }; }
      if (!cfg.auth) { if (session) { save(null); changed(); } return false; }
      if (session && expired() && await refresh()) changed();
      return true;
    },
    /** Servern sa att token inte gick att verifiera: försök förnya en gång, annars logga ut lokalt. */
    async rejected() {
      if (await refresh()) { changed(); return true; }
      save(null); changed(); return false;
    },
    async sendMagicLink(email) {
      const r = await api(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo())}`, { method: 'POST', body: JSON.stringify({ email, create_user: true }) });
      if (!r.ok) {
        let msg = 'Kunde inte skicka länken.';
        try { const d = await r.json(); if (r.status === 429) msg = 'För många försök – vänta en stund och försök igen.'; else if (d.msg || d.error_description) msg += ' ' + (d.msg || d.error_description); } catch {}
        throw new Error(msg);
      }
    },
    google() { location.href = `${cfg.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo())}`; },
    async logout() {
      const t = session && session.access_token;
      save(null); changed();
      if (t && cfg && cfg.auth) { try { await api('/auth/v1/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }); } catch {} }
    },
    /** Efter "Radera mitt konto": glöm sessionen här. */
    forget() { save(null); changed(); },
  };
})();
