// ============================================================
// usage-log.js — track songs sung in services
// ============================================================
//
// Exposes `UsageLog` with the in-memory event log and CRUD +
// reporting functions.
//
// An "event" represents one service where songs were played.
// Events are stored in localStorage under a versioned key.
// ============================================================

window.UsageLog = (function () {
  'use strict';

  const Storage = window.Storage;

  const STORAGE_KEY = 'worship-charts-usage-log-v1';

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  let events = [];  // array of event objects

  // ------------------------------------------------------------
  // UTILITIES
  // ------------------------------------------------------------
  function makeEventId() {
    return 'usage-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 10000);
  }

  function isoDate(d) {
    const dt = d instanceof Date ? d : new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function today() {
    return isoDate(new Date());
  }

  // ------------------------------------------------------------
  // PERSISTENCE
  // ------------------------------------------------------------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { events = []; return events; }
      const parsed = JSON.parse(raw);
      events = Array.isArray(parsed) ? parsed : [];
      return events;
    } catch (e) {
      console.warn('[UsageLog] Could not load events:', e);
      events = [];
      return events;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch (e) {
      console.warn('[UsageLog] Could not save events:', e);
    }
  }

  // ------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------
  function getAll() {
    return events.slice();
  }

  function getById(id) {
    return events.find(e => e.id === id) || null;
  }

  // Add a new event. `songs` should be an array of objects that
  // have at least { id, title, artist }.
  function addEvent({ date, setlistId, setlistName, notes, songs }) {
    // Snapshot song metadata into the event so historical records
    // survive library changes
    const songSnapshots = (songs || []).map(s => ({
      songId: s.id,
      title: s.title,
      artist: s.artist || 'Unknown'
    }));

    const ev = {
      id: makeEventId(),
      date: date || today(),
      setlistId: setlistId || null,
      setlistName: setlistName || '',
      notes: notes || '',
      songs: songSnapshots,
      createdAt: Date.now()
    };
    events.push(ev);
    save();
    return ev;
  }

  function removeEvent(id) {
    const idx = events.findIndex(e => e.id === id);
    if (idx === -1) return false;
    events.splice(idx, 1);
    save();
    return true;
  }

  // ------------------------------------------------------------
  // AGGREGATION
  // ------------------------------------------------------------
  // Return aggregated usage stats per song (by songId + title).
  //
  //   {
  //     songId, title, artist,
  //     timesUsed, lastUsed (ISO date),
  //     events: [eventId, ...]
  //   }
  //
  // Uses songId as the primary key, but falls back to title if
  // the songId is missing (defensive against old records).
  function getStats() {
    const map = new Map();

    events.forEach(ev => {
      ev.songs.forEach(song => {
        const key = song.songId || ('title:' + song.title.toLowerCase());
        if (!map.has(key)) {
          map.set(key, {
            songId: song.songId || null,
            title: song.title,
            artist: song.artist || 'Unknown',
            timesUsed: 0,
            lastUsed: '',
            events: []
          });
        }
        const entry = map.get(key);
        entry.timesUsed++;
        if (!entry.lastUsed || ev.date > entry.lastUsed) {
          entry.lastUsed = ev.date;
        }
        entry.events.push(ev.id);
      });
    });

    return Array.from(map.values());
  }

  // Get stats filtered by date range [from, to] — both ISO strings.
  // Either can be empty to indicate no bound.
  function getStatsInRange(from, to) {
    const all = getStats();
    if (!from && !to) return all;

    // Recompute times used within range
    const stats = all.map(s => ({ ...s, timesUsed: 0, lastUsed: '', events: [] }));
    const byKey = new Map();
    stats.forEach(s => {
      const key = s.songId || ('title:' + s.title.toLowerCase());
      byKey.set(key, s);
    });

    events.forEach(ev => {
      if (from && ev.date < from) return;
      if (to && ev.date > to) return;
      ev.songs.forEach(song => {
        const key = song.songId || ('title:' + song.title.toLowerCase());
        const entry = byKey.get(key);
        if (!entry) return;
        entry.timesUsed++;
        if (!entry.lastUsed || ev.date > entry.lastUsed) {
          entry.lastUsed = ev.date;
        }
        entry.events.push(ev.id);
      });
    });

    return stats.filter(s => s.timesUsed > 0);
  }

  // ------------------------------------------------------------
  // CSV EXPORT
  // ------------------------------------------------------------
  // Produce a per-usage CSV row for each song sung in each event.
  // This is the format CCLI most commonly accepts for annual
  // reporting.
  function toCSV(filterFn) {
    const rows = [['Date', 'Song Title', 'Author', 'CCLI Number', 'Service Notes']];

    const sorted = events.slice().sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach(ev => {
      if (filterFn && !filterFn(ev)) return;
      ev.songs.forEach(song => {
        rows.push([
          ev.date,
          song.title || '',
          song.artist || '',
          '',                       // CCLI number left blank for user to fill
          ev.notes || ev.setlistName || ''
        ]);
      });
    });

    // CSV escape: wrap every field in quotes, escape internal quotes
    return rows.map(row =>
      row.map(field => {
        const s = String(field == null ? '' : field);
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(',')
    ).join('\n');
  }

  // ------------------------------------------------------------
  // PUBLIC API
  // ------------------------------------------------------------
  return {
    // Lifecycle
    load,
    save,

    // CRUD
    getAll,
    getById,
    addEvent,
    removeEvent,

    // Aggregation
    getStats,
    getStatsInRange,

    // Export
    toCSV,

    // Utilities
    today,
    isoDate
  };
})();