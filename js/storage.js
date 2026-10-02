// ============================================================
// storage.js — localStorage load/save
// ============================================================
//
// Exposes a global `Storage` namespace with the small set of
// read/write operations the app needs. Everything is namespaced
// under a versioned key so we can migrate later without losing
// users' data.
// ============================================================

window.Storage = (function () {
  'use strict';

  // Bump these if the data shape changes in a breaking way.
  const KEYS = {
    SONGS:    'worship-charts-custom-songs-v2',
    SETLISTS: 'worship-charts-setlists-v1',
    SEEDED:   'worship-charts-seeded-v1'
  };

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn('[Storage] Could not read', key, e);
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.warn('[Storage] Could not write', key, e);
      return false;
    }
  }

  // ---------- Songs ----------
  function loadSongs() {
    const raw = safeGet(KEYS.SONGS);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[Storage] Malformed songs JSON, resetting:', e);
      return [];
    }
  }

  function saveSongs(list) {
    if (!Array.isArray(list)) return false;
    return safeSet(KEYS.SONGS, JSON.stringify(list));
  }

  // ---------- Setlists ----------
  function loadSetlists() {
    const raw = safeGet(KEYS.SETLISTS);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[Storage] Malformed setlists JSON, resetting:', e);
      return [];
    }
  }

  function saveSetlists(list) {
    if (!Array.isArray(list)) return false;
    return safeSet(KEYS.SETLISTS, JSON.stringify(list));
  }

  // ---------- Seeded flag ----------
  function hasSeeded() {
    return safeGet(KEYS.SEEDED) === '1';
  }

  function markSeeded() {
    return safeSet(KEYS.SEEDED, '1');
  }

  return {
    KEYS,
    loadSongs,
    saveSongs,
    loadSetlists,
    saveSetlists,
    hasSeeded,
    markSeeded
  };
})();