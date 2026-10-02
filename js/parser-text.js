// ============================================================
// parser-text.js — plain text → HTML chord sheet
// ============================================================
//
// Exposes `ParserText`. Takes a plain-text chord sheet in the
// classic two-line format:
//
//   [Verse 1]
//   Bb         Eb
//   Light of the world, You stepped down into darkness
//
// and converts it into the same HTML the PDF parser produces.
//
// Also exposes a couple of helpers (mergeChordFragments,
// looksLikeChordLine) that parser-pdf.js reuses.
// ============================================================

window.ParserText = (function () {
  'use strict';

  const MT = window.MusicTheory;

  // ---------- Performance directions ----------
  // Recognize trailing parenthesized directions like "(To Verse 2)"
  // or "(Last x)" so they don't get treated as chords.
  function extractPerformanceDirection(text) {
    if (!text) return { cleaned: text, direction: '' };
    const m = text.match(/\s*(\((?:To\s+)?[A-Z][^)]*\))\s*$/);
    if (m) {
      return {
        cleaned: text.slice(0, text.length - m[0].length).trim(),
        direction: m[1].trim()
      };
    }
    return { cleaned: text, direction: '' };
  }

  // ---------- Fragment merging ----------
  // A token like "(4)" or "7" or "sus" alone is an extension
  // fragment, not a chord. It should be glued to the previous
  // token if that forms a valid chord.
  function isExtensionFragment(token) {
    if (!token) return false;
    const t = token.trim();
    if (!t) return false;
    if (/^\([^)]*\)$/.test(t)) return true;
    if (/^(2|4|5|6|7|9|11|13)$/.test(t)) return true;
    if (/^(sus|add|maj|min|dim|aug|m|M|dom|no|omit)$/i.test(t)) return true;
    if (/^(sus|add|maj|min|dim|aug|dom|no|omit)[0-9]+$/i.test(t)) return true;
    if (/^(no|omit|add|sus)[0-9]+$/i.test(t)) return true;
    if (/^[#b][0-9]+$/.test(t)) return true;
    return false;
  }

  function looksLikeDirectionStart(token) {
    if (!token) return false;
    if (/^\([^)]*$/.test(token)) return true;
    if (/^\([^)]*\)$/.test(token) && /[A-Z]/.test(token)) return true;
    return false;
  }

  // Merge adjacent extension fragments back into the preceding chord.
  //   ["Gb", "Db", "(4)"]        → ["Gb", "Db(4)"]
  //   ["Ebm", "7", "Db", "(4)"]  → ["Ebm7", "Db(4)"]
  function mergeChordFragments(tokens) {
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      let current = tokens[i];
      if (looksLikeDirectionStart(current)) {
        out.push(current);
        i++;
        continue;
      }
      while (i + 1 < tokens.length) {
        const next = tokens[i + 1];
        if (looksLikeDirectionStart(next)) break;
        const combined = current + next;
        if (MT.isStrictChord(next)) break;
        if (!isExtensionFragment(next)) break;
        if (MT.isStrictChord(combined)) {
          current = combined;
          i++;
        } else {
          break;
        }
      }
      out.push(current);
      i++;
    }
    return out;
  }

  // ---------- Classification ----------
  function looksLikeChordLine(line) {
    const { cleaned } = extractPerformanceDirection(line);
    const rawTokens = cleaned.trim().split(/\s+/).filter(Boolean);
    if (rawTokens.length === 0) return false;
    const tokens = mergeChordFragments(rawTokens);
    const chordCount = tokens.filter(t => MT.isStrictChord(t)).length;
    return chordCount / tokens.length >= 0.6;
  }

  function looksLikeChordOnlyLine(text) {
    const { cleaned } = extractPerformanceDirection(text);
    const rawTokens = cleaned.trim().split(/\s+/).filter(Boolean);
    if (rawTokens.length === 0) return false;
    const tokens = mergeChordFragments(rawTokens);
    const chordCount = tokens.filter(t => MT.isStrictChord(t)).length;
    return chordCount / tokens.length >= 0.75;
  }

  // ---------- Position extraction ----------
  // Return [{ chord, col }, ...] for a chord line, where col is
  // the character index in the original line. Used for alignment.
  function parseChordPositions(chordLine) {
    const { cleaned } = extractPerformanceDirection(chordLine);
    const positions = [];
    const rawRe = /(\S+)/g;
    const rawTokens = [];
    let m;
    while ((m = rawRe.exec(cleaned)) !== null) {
      rawTokens.push({ token: m[1], col: m.index });
    }

    const merged = [];
    let i = 0;
    while (i < rawTokens.length) {
      let current = rawTokens[i];
      if (looksLikeDirectionStart(current.token)) {
        merged.push(current);
        i++;
        continue;
      }
      while (i + 1 < rawTokens.length) {
        const next = rawTokens[i + 1];
        if (looksLikeDirectionStart(next.token)) break;
        const combined = current.token + next.token;
        if (MT.isStrictChord(next.token)) break;
        if (!isExtensionFragment(next.token)) break;
        if (MT.isStrictChord(combined)) {
          current = { token: combined, col: current.col };
          i++;
        } else {
          break;
        }
      }
      merged.push(current);
      i++;
    }

    merged.forEach(t => {
      if (MT.isStrictChord(t.token)) {
        positions.push({ chord: t.token, col: t.col });
      }
    });
    return positions;
  }

  // ---------- HTML builders ----------
  function escapeLyricForHtml(text) {
    const escaped = String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return escaped.replace(/ /g, '&nbsp;');
  }

  function buildLineHtml(chordPositions, lyricLine) {
    if (chordPositions.length === 0) {
      return `<div class="line"><span class="pair"><span class="chord empty">&nbsp;</span><span class="lyric">${escapeLyricForHtml(lyricLine.replace(/\s+$/, ''))}</span></span></div>`;
    }
    let html = '<div class="line">';
    for (let i = 0; i < chordPositions.length; i++) {
      const { chord, col } = chordPositions[i];
      const nextCol = (i + 1 < chordPositions.length) ? chordPositions[i + 1].col : lyricLine.length;
      let syllable = (col < lyricLine.length)
        ? lyricLine.slice(col, Math.min(nextCol, lyricLine.length))
        : '';
      const trimmed = syllable.replace(/^\s+/, '').replace(/\s+$/, '');
      if (!trimmed) {
        html += `<span class="pair"><span class="chord" data-chord="${MT.escapeHtml(chord)}">${MT.escapeHtml(chord)}</span><span class="lyric">&nbsp;</span></span>`;
      } else {
        html += `<span class="pair"><span class="chord" data-chord="${MT.escapeHtml(chord)}">${MT.escapeHtml(chord)}</span><span class="lyric">${escapeLyricForHtml(trimmed)}</span></span>`;
      }
    }
    html += '</div>';
    return html;
  }

  // ---------- Main converter ----------
  function plainTextToHtml(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      const trimmed = raw.trim();

      // [Section] labels
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        out.push(`<div class="section">${MT.escapeHtml(sectionMatch[1].trim())}</div>`);
        i++;
        continue;
      }

      if (trimmed === '') { i++; continue; }

      // Chord line + following lyric line
      if (looksLikeChordLine(raw) && /[A-G]/.test(trimmed)) {
        const { direction } = extractPerformanceDirection(raw);
        const positions = parseChordPositions(raw);
        const nextLine = (i + 1 < lines.length) ? lines[i + 1] : '';
        const nextTrimmed = nextLine.trim();
        const nextIsChordLine = nextLine && looksLikeChordLine(nextLine) && /[A-G]/.test(nextTrimmed);
        const nextIsSection = /^\[[^\]]+\]$/.test(nextTrimmed);

        if (nextTrimmed !== '' && !nextIsChordLine && !nextIsSection) {
          out.push(buildLineHtml(positions, nextLine));
          if (direction) out.push(`<div class="direction">${MT.escapeHtml(direction)}</div>`);
          i += 2;
          continue;
        } else {
          const chordStr = positions
            .map(p => `<span class="chord" data-chord="${MT.escapeHtml(p.chord)}">${MT.escapeHtml(p.chord)}</span>`)
            .join('  ');
          out.push(`<div class="instr">${chordStr}</div>`);
          if (direction) out.push(`<div class="direction">${MT.escapeHtml(direction)}</div>`);
          i++;
          continue;
        }
      }

      // Plain lyric line with no chords
      out.push(`<div class="line"><span class="pair"><span class="chord empty">&nbsp;</span><span class="lyric">${escapeLyricForHtml(trimmed)}</span></span></div>`);
      i++;
    }
    return out.join('\n');
  }

  return {
    extractPerformanceDirection,
    isExtensionFragment,
    looksLikeDirectionStart,
    mergeChordFragments,
    looksLikeChordLine,
    looksLikeChordOnlyLine,
    parseChordPositions,
    buildLineHtml,
    escapeLyricForHtml,
    plainTextToHtml
  };
})();