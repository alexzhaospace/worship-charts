// ============================================================
// parser-formats.js — format detection + header normalization
// ============================================================
//
// Different chord chart sources use different conventions for
// section headers and metadata. This module normalizes them so
// the PDF parser can treat every source uniformly.
//
// Supported formats:
//   - SongSelect: "## VERSE 1", "Key - C | Tempo - 76 | Time - 4/4"
//   - Psalmnote:  "# Verse 1",   "Key: C"
//   - Generic:    "VERSE 1",     "Key: C", "Key - C"
// ============================================================

window.ParserFormats = (function () {
  'use strict';

  // ------------------------------------------------------------
  // SECTION HEADERS
  // ------------------------------------------------------------
  // Recognize a line as a section header regardless of:
  //   - leading "#" markers (##, #, or none)
  //   - case (VERSE 1, Verse 1, verse 1)
  //   - trailing punctuation
  //
  // We return the normalized name (e.g. "Verse 1") so the display
  // can be consistent, plus a boolean saying whether it was likely
  // a section header at all.

  const SECTION_KEYWORDS = [
    'VERSE', 'CHORUS', 'BRIDGE', 'PRE-CHORUS', 'PRECHORUS', 'PRE CHORUS',
    'INTRO', 'OUTRO', 'TAG', 'ENDING', 'INSTRUMENTAL', 'INTERLUDE',
    'REFRAIN', 'VAMP', 'TURNAROUND', 'SOLO', 'BREAKDOWN',
    // Common in Psalmnote & other sources
    'CHORUS 1', 'CHORUS 2', 'VERSE 1', 'VERSE 2', 'VERSE 3',
    'CHORUS 1A', 'CHORUS 1B', 'CHORUS 1C',
    'BRIDGE 1', 'BRIDGE 2', 'BRIDGE 3'
  ];

  // Try to interpret a line as a section header. Returns null if
  // not a section header.
  function parseSectionHeader(text) {
    if (!text) return null;
    let t = String(text).trim();
    if (!t) return null;

    // Strip leading hash marks (##, #, or none)
    const hadHash = /^#+\s*/.test(t);
    t = t.replace(/^#+\s*/, '').trim();

    // Strip trailing punctuation
    t = t.replace(/[:\-–—]+$/, '').trim();

    // Must be reasonably short to be a header
    if (t.length > 40) return null;

    const upper = t.toUpperCase();
    const firstWord = upper.split(/\s+/)[0];

    // Must start with a known section keyword
    const matches = SECTION_KEYWORDS.some(kw =>
      upper === kw || upper.startsWith(kw + ' ') || firstWord === kw
    );

    if (!matches) return null;

    // Normalize to Title Case for consistent display
    // (e.g. "VERSE 1" → "Verse 1", "CHORUS 1A" → "Chorus 1A")
    const normalized = upper
      .split(/\s+/)
      .map(word => {
        // Keep short numbers/suffixes uppercase ("1A", "2")
        if (/^[0-9A-Z]+$/.test(word)) return word;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');

    return {
      raw: text.trim(),
      normalized,
      hadHash
    };
  }

  // ------------------------------------------------------------
  // METADATA
  // ------------------------------------------------------------
  // Extract artist and key from a metadata line. Handles:
  //   "Chris Tomlin | Ed Cash | Jesse Reeves Key - C | Tempo - 76"
  //   "Key: C"
  //   "Key - C"
  //   "Philip Nathan Thompson | Zenzo Matoga"
  //   "Phil Thompson, My Worship"
  //   "Key: C" alone (no artist on the line)

  function parseMetadataLine(text) {
    const meta = { artist: '', key: '', tempo: '', time: '' };
    if (!text) return meta;

    let t = String(text).trim();
    if (!t) return meta;

    // ---------- Key ----------
    // Matches "Key - C", "Key: C", "Key - Cm", "Key: Bb"
    const keyMatch = t.match(/\bKey\s*[-:]\s*([A-G][#b]?m?)\b/i);
    if (keyMatch) meta.key = keyMatch[1].trim();

    // ---------- Tempo ----------
    const tempoMatch = t.match(/\bTempo\s*[-:]\s*(\d+)/i);
    if (tempoMatch) meta.tempo = tempoMatch[1];

    // ---------- Time signature ----------
    const timeMatch = t.match(/\bTime\s*[-:]\s*(\d+\/\d+)/i);
    if (timeMatch) meta.time = timeMatch[1];

    // ---------- Artist ----------
    // Cut off everything from "Key" onward, then clean up
    let artistPart = t;
    const cutPoints = [
      t.search(/\bKey\s*[-:]/i),
      t.search(/\bTempo\s*[-:]/i),
      t.search(/\bTime\s*[-:]/i),
      t.search(/\|\s*Time\b/i),
      t.search(/\|\s*Tempo\b/i)
    ].filter(i => i >= 0).sort((a, b) => a - b);

    if (cutPoints.length > 0) {
      artistPart = t.slice(0, cutPoints[0]);
    }

    // Strip trailing pipe, whitespace
    artistPart = artistPart.replace(/\s*\|\s*$/, '').trim();

    // Strip "(as published by ...)" parentheticals
    artistPart = artistPart.replace(/\s*\(as published[^)]*\)/i, '');
    artistPart = artistPart.replace(/\s*\(as published by[^)]*\)/i, '');

    // Normalize commas and pipes to pipes for consistency
    artistPart = artistPart.replace(/\s*,\s*/g, ' | ');

    // Collapse whitespace
    artistPart = artistPart.replace(/\s+/g, ' ').trim();

    // Strip leftover artifacts
    artistPart = artistPart.replace(/^#+\s*/, '').trim();
    artistPart = artistPart.replace(/^\d+\s+/, '').trim();

    meta.artist = artistPart;
    return meta;
  }

  // Does a line look like metadata (has Key/Tempo/Time)?
  function looksLikeMetadata(text) {
    if (!text) return false;
    return /\bKey\s*[-:]|\bTempo\s*[-:]|\bTime\s*[-:]|\|\s*(Time|Tempo|Key)\b/i.test(text);
  }

  // ------------------------------------------------------------
  // FORMAT DETECTION (informational, for logging/debug)
  // ------------------------------------------------------------
  function detectFormat(blocks) {
    // Look at the first few lines for signature patterns
    const allText = [];
    blocks.forEach(b => b.lines.forEach(l => allText.push(l.text || '')));
    const sample = allText.slice(0, 50).join('\n');

    if (/#{2}\s+[A-Z]+\s+\d/.test(sample)) return 'songselect';
    if (/^#\s+[A-Z][a-z]+\s+\d/m.test(sample)) return 'psalmnote';
    if (/Key\s*[-:]\s*[A-G]/.test(sample)) return 'generic';
    return 'unknown';
  }

  return {
    SECTION_KEYWORDS,
    parseSectionHeader,
    parseMetadataLine,
    looksLikeMetadata,
    detectFormat
  };
})();