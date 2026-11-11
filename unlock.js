/**
 * ShiftMate UK — serverless unlock helpers for a Stripe Payment Link.
 * After payment, Stripe redirects to this static app with ?unlocked=CODE,
 * or the user pastes the same code. Verified by SHA-256 against UNLOCK_CODE_SHA256.
 * No backend required (GitHub Pages friendly).
 */
(function (global) {
  'use strict';

  function storageKey(config) {
    return (config && config.UNLOCK_STORAGE_KEY) || 'shiftmate-uk-unlock-v1';
  }

  function getStorage(store) {
    if (store) return store;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_) {}
    return null;
  }

  async function sha256Hex(text) {
    const subtle = global.crypto && global.crypto.subtle;
    if (!subtle) throw new Error('SubtleCrypto is not available');
    const data = new TextEncoder().encode(String(text));
    const buf = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let out = 0;
    for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return out === 0;
  }

  function readState(config, store) {
    const s = getStorage(store);
    if (!s) return { unlocked: false };
    try {
      const raw = s.getItem(storageKey(config));
      if (!raw) return { unlocked: false };
      const parsed = JSON.parse(raw);
      return {
        unlocked: !!parsed.unlocked,
        unlockedAt: parsed.unlockedAt || null,
      };
    } catch (_) {
      return { unlocked: false };
    }
  }

  function writeState(config, state, store) {
    const s = getStorage(store);
    if (!s) return;
    s.setItem(
      storageKey(config),
      JSON.stringify({
        unlocked: !!state.unlocked,
        unlockedAt: state.unlockedAt || new Date().toISOString(),
      })
    );
  }

  /**
   * When UNLOCK_ENABLED is false, features stay fully available.
   */
  function isLicensed(config, state) {
    if (!config || !config.UNLOCK_ENABLED) return true;
    return !!(state && state.unlocked);
  }

  function horizonIso(todayIso, weeksAhead, pay) {
    const P = pay || global.ShiftMatePay;
    const weeks = Math.max(0, Number(weeksAhead) || 0);
    const start = P.parseLocalDateTime(P.toDateIso(todayIso) + 'T00:00');
    return P.toDateIso(P.addDays(start, weeks * 7));
  }

  function isDateBeyondHorizon(dateIso, todayIso, weeksAhead, pay) {
    const P = pay || global.ShiftMatePay;
    return P.toDateIso(dateIso) > horizonIso(todayIso, weeksAhead, P);
  }

  async function verifyUnlockCode(code, expectedHash) {
    const trimmed = String(code || '').trim();
    const expected = String(expectedHash || '').trim().toLowerCase();
    if (!expected) return { ok: false, reason: 'not-configured' };
    if (!trimmed) return { ok: false, reason: 'empty' };
    if (!/^[0-9a-f]{64}$/.test(expected)) return { ok: false, reason: 'not-configured' };
    const hash = await sha256Hex(trimmed);
    if (timingSafeEqual(hash, expected)) return { ok: true };
    return { ok: false, reason: 'mismatch' };
  }

  function extractUnlockCodeFromSearch(search) {
    const raw = String(search || '');
    const q = raw.charAt(0) === '?' ? raw.slice(1) : raw;
    if (!q) return null;
    const params = new URLSearchParams(q);
    const code = params.get('unlocked');
    if (code == null || String(code).trim() === '') return null;
    return String(code);
  }

  /**
   * Drop ?unlocked= from a URL, keeping path, other params, and hash.
   * Works under a GitHub Pages subpath.
   */
  function stripUnlockParam(href) {
    const base = 'http://local.invalid';
    const u = new URL(href, base);
    u.searchParams.delete('unlocked');
    const search = u.searchParams.toString();
    return u.pathname + (search ? '?' + search : '') + u.hash;
  }

  async function consumeRedirect(search, config, store) {
    const code = extractUnlockCodeFromSearch(search);
    if (!code) return { present: false };
    const result = await verifyUnlockCode(code, config && config.UNLOCK_CODE_SHA256);
    if (!result.ok) return { present: true, ok: false, reason: result.reason };
    writeState(
      config,
      { unlocked: true, unlockedAt: new Date().toISOString() },
      store
    );
    return { present: true, ok: true };
  }

  const api = {
    sha256Hex,
    timingSafeEqual,
    readState,
    writeState,
    isLicensed,
    horizonIso,
    isDateBeyondHorizon,
    verifyUnlockCode,
    extractUnlockCodeFromSearch,
    stripUnlockParam,
    consumeRedirect,
  };

  global.ShiftMateUnlock = api;
})(typeof window !== 'undefined' ? window : globalThis);
