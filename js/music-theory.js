// ============================================================
// music-theory.js — chord grammar, transposition, Nashville, key math
// ============================================================
//
// Exposes a global `MusicTheory` namespace. Everything here is
// pure: no DOM, no state, no side effects. Callers pass in chords
// and keys, they get back transformed chords and key info.
// ============================================================

window.MusicTheory = (function () {
  'use strict';

  // ---------- Constants ----------
  const SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const FLAT_NAMES  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

  const NOTE_TO_PC = {
    'C':0,'B#':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'Fb':4,
    'F':5,'E#':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,'Cb':11
  };

  // Selectable keys in the UI — mixes sharps and flats the way
  // worship musicians typically read them.
  const KEY_OPTIONS = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

  // Keys that sound better with flats when spelled enharmonically.
  const NICE_FLAT_KEYS = new Set(['F','Bb','Eb','Ab','Db','Gb']);

  // Map semitones above the key root to Nashville numbers.
  // Prefer the simpler accidental (b3 over #2, etc.).
  const PC_TO_NASHVILLE = [
    '1', 'b2', '2', 'b3', '3', '4',
    '#4', '5', 'b6', '6', 'b7', '7'
  ];

  // ============================================================
  // CHORD GRAMMAR
  // ============================================================
  //
  // Recognizes a wide variety of chord shapes, including:
  //   C, Cm, Cmaj7, C7, C9, Csus, Csus2, Csus4, Cadd9
  //   Cdim, Caug, C+, C°, Cø
  //   C(4), C(no3), C(add9), C(#11), Cm(maj7), Cm7(b5)
  //   C/E, D/F#, G/B
  const ROOT = '[A-G][#b]?';
  const QUALITY = '(?:maj|min|sus|add|aug|dim|dom|M|m|\\+|°|ø)';
  const NUMBER = '(?:[0-9]|1[0-3])';
  const PAREN = '\\([^)]*\\)';
  const EXTENSION =
    '(?:' +
      QUALITY + '|' +
      NUMBER + '|' +
      '(?:no|omit|add|sus)' + NUMBER + '|' +
      PAREN +
    ')*';
  const BASS = '(?:\\/' + ROOT + ')?';
  const CHORD_RE = new RegExp('^' + ROOT + EXTENSION + BASS + '$');

  function isStrictChord(token) {
    if (!token) return false;
    token = String(token).trim();
    if (!token) return false;
    if (!/^[A-G]/.test(token)) return false;
    if (token.length > 15) return false;
    return CHORD_RE.test(token);
  }

  // ============================================================
  // CHORD SPLITTING
  // ============================================================
  // Split a chord into root / extension / bass.
  //   "F#m7"    → { root: 'F#', extension: 'm7', bass: null }
  //   "D/F#"    → { root: 'D',  extension: '',   bass: 'F#' }
  //   "Eb2(no3)"→ { root: 'Eb', extension: '2(no3)', bass: null }
  function rootEndIndex(chord) {
    if (!chord || chord.length === 0) return 0;
    if (!/[A-G]/.test(chord[0])) return 0;
    return (chord[1] === '#' || chord[1] === 'b') ? 2 : 1;
  }

  function splitChord(chord) {
    const rootEnd = rootEndIndex(chord);
    if (rootEnd === 0) return null;
    const root = chord.slice(0, rootEnd);
    let rest = chord.slice(rootEnd);
    let bass = null;
    const slashIdx = rest.indexOf('/');
    if (slashIdx !== -1) {
      bass = rest.slice(slashIdx + 1);
      rest = rest.slice(0, slashIdx);
    }
    return { root, extension: rest, bass };
  }

  // ============================================================
  // TRANSPOSITION
  // ============================================================
  // Transpose a chord by N semitones. Root and bass move;
  // extension stays as written (so Fsus + 2 → Gsus, not Gsus2).
  function transposeChord(chord, semitones, preferFlats) {
    if (!chord || semitones === 0) return chord;
    const parts = splitChord(chord);
    if (!parts) return chord;

    const table = preferFlats ? FLAT_NAMES : SHARP_NAMES;
    const rootPc = NOTE_TO_PC[parts.root];
    if (rootPc === undefined) return chord;
    const newRoot = table[(rootPc + semitones + 120) % 12];

    let newBass = parts.bass;
    if (parts.bass) {
      const bassPc = NOTE_TO_PC[parts.bass];
      if (bassPc !== undefined) {
        newBass = table[(bassPc + semitones + 120) % 12];
      }
    }
    return newRoot + parts.extension + (newBass ? '/' + newBass : '');
  }

  // ============================================================
  // NASHVILLE NUMBER SYSTEM
  // ============================================================
  // Convert a chord to its Nashville equivalent given a key's
  // pitch class. E.g. "F#m7" in key A (pc 9) → "6m7".
  function chordToNashville(chord, keyPc) {
    if (!chord) return chord;
    const parts = splitChord(chord);
    if (!parts) return chord;

    const rootPc = NOTE_TO_PC[parts.root];
    if (rootPc === undefined) return chord;
    const rootOffset = (rootPc - keyPc + 12) % 12;
    const nashvilleRoot = PC_TO_NASHVILLE[rootOffset];

    let nashvilleBass = null;
    if (parts.bass) {
      const bassPc = NOTE_TO_PC[parts.bass];
      if (bassPc !== undefined) {
        const bassOffset = (bassPc - keyPc + 12) % 12;
        nashvilleBass = PC_TO_NASHVILLE[bassOffset];
      }
    }
    return nashvilleRoot + parts.extension + (nashvilleBass ? '/' + nashvilleBass : '');
  }

  // ============================================================
  // KEY MATH
  // ============================================================
  // Return the prettiest enharmonic spelling for a pitch class.
  function computeKeyName(pc) {
    const sharpName = SHARP_NAMES[(pc + 12) % 12];
    const flatName  = FLAT_NAMES[(pc + 12) % 12];
    const preferFlats = NICE_FLAT_KEYS.has(flatName) && sharpName.includes('#');
    return {
      name: preferFlats ? flatName : sharpName,
      preferFlats,
      pc: (pc + 12) % 12
    };
  }

  // Given a song (with .key) and a shift, what key are we in?
  function computeTargetKey(song, shift) {
    const origPc = NOTE_TO_PC[song.key] ?? 0;
    const newPc = (origPc + shift + 120) % 12;
    return computeKeyName(newPc);
  }

  // What key would a guitarist PLAY when using a capo?
  // (sounding key − capo = shape key)
  function computeCapoShapeKey(song, shift, capo) {
    const sounding = computeTargetKey(song, shift);
    const shapePc = (sounding.pc - capo + 120) % 12;
    return computeKeyName(shapePc);
  }

  // Given two pitch classes, what's the smallest signed shift?
  // (used when the user picks a target key from the dropdown)
  function semitoneShiftBetween(fromKey, toKey) {
    const a = NOTE_TO_PC[fromKey];
    const b = NOTE_TO_PC[toKey];
    if (a === undefined || b === undefined) return 0;
    let diff = (b - a + 12) % 12;
    if (diff > 6) diff -= 12;
    return diff;
  }

  // ============================================================
  // KEY INFERENCE
  // ============================================================
  // If a song has no explicit key, guess it from the most common
  // chord root in the sheet. In worship music the tonic chord is
  // almost always the most frequent.
  function inferKeyFromHtml(chordSheetHtml) {
    const re = /data-chord="([^"]+)"/g;
    const counts = {};
    let m;
    while ((m = re.exec(chordSheetHtml)) !== null) {
      const chord = m[1];
      const rootEnd = rootEndIndex(chord);
      if (rootEnd === 0) continue;
      const root = chord.slice(0, rootEnd);
      const pc = NOTE_TO_PC[root];
      if (pc === undefined) continue;
      counts[pc] = (counts[pc] || 0) + 1;
    }

    let bestPc = null, bestCount = 0;
    for (const pcStr in counts) {
      if (counts[pcStr] > bestCount) {
        bestCount = counts[pcStr];
        bestPc = parseInt(pcStr, 10);
      }
    }
    if (bestPc === null) return null;
    return computeKeyName(bestPc).name;
  }

  // ============================================================
  // CHORD HTML RENDERING (shared by render.js and pdf-export.js)
  // ============================================================
  // Split a chord into a small HTML fragment where the extension
  // is superscripted. Used everywhere chord text is displayed.
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderChordHtml(chord) {
    if (!chord) return '';
    const rootMatch = chord.match(/^([A-G][#b]?)/);
    if (!rootMatch) return escapeHtml(chord);
    const root = rootMatch[1];
    let rest = chord.slice(root.length);

    let bass = '';
    const slashIdx = rest.indexOf('/');
    if (slashIdx !== -1) {
      bass = rest.slice(slashIdx);
      rest = rest.slice(0, slashIdx);
    }

    let html = `<span class="chord-root">${escapeHtml(root)}</span>`;
    if (rest) html += `<span class="chord-sup">${escapeHtml(rest)}</span>`;
    if (bass) html += `<span class="chord-bass">${escapeHtml(bass)}</span>`;
    return html;
  }

  function renderNashvilleHtml(nashville) {
    if (!nashville) return '';
    const slashIdx = nashville.indexOf('/');
    if (slashIdx === -1) return escapeHtml(nashville);
    const root = nashville.slice(0, slashIdx);
    const bass = nashville.slice(slashIdx);
    return escapeHtml(root) + `<span class="chord-bass">${escapeHtml(bass)}</span>`;
  }

  return {
    // Constants
    SHARP_NAMES,
    FLAT_NAMES,
    NOTE_TO_PC,
    KEY_OPTIONS,
    NICE_FLAT_KEYS,
    PC_TO_NASHVILLE,

    // Grammar
    isStrictChord,
    rootEndIndex,
    splitChord,

    // Transforms
    transposeChord,
    chordToNashville,

    // Key math
    computeKeyName,
    computeTargetKey,
    computeCapoShapeKey,
    semitoneShiftBetween,
    inferKeyFromHtml,

    // Rendering helpers
    escapeHtml,
    renderChordHtml,
    renderNashvilleHtml
  };
})();