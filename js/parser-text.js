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

    // Compute the leading whitespace of the chord line. We'll subtract
    // this from every chord's column so positions are relative to the
    // first visible character — this makes them align with lyric lines
    // that may have a different amount of leading indentation.
    const leadingWhitespace = cleaned.length - cleaned.replace(/^\s+/, '').length;

    merged.forEach(t => {
      if (MT.isStrictChord(t.token)) {
        positions.push({
          chord: t.token,
          col: Math.max(0, t.col - leadingWhitespace)
        });
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

    // Compute the lyric line's own leading whitespace and normalize
    // chord positions relative to it. This handles the case where the
    // chord line is indented more (or less) than the lyric line — a
    // common pattern in pasted web chord sheets like WorshipChords.
    const lyricLeading = lyricLine.length - lyricLine.replace(/^\s+/, '').length;
    const normalizedChords = chordPositions.map(p => ({
      chord: p.chord,
      col: Math.max(0, p.col - lyricLeading)
    }));

    let html = '<div class="line">';
    for (let i = 0; i < normalizedChords.length; i++) {
      const { chord, col } = normalizedChords[i];
      const nextCol = (i + 1 < normalizedChords.length)
        ? normalizedChords[i + 1].col
        : lyricLine.length;

      // Slice the lyric from `col` up to `nextCol`, clamped to bounds.
      const start = Math.min(col, lyricLine.length);
      const end = Math.min(Math.max(nextCol, start), lyricLine.length);
      let syllable = lyricLine.slice(start, end);
      // Trim leading/trailing whitespace from the slice.
      syllable = syllable.replace(/^\s+/, '').replace(/\s+$/, '');

      if (!syllable) {
        html += `<span class="pair"><span class="chord" data-chord="${MT.escapeHtml(chord)}">${MT.escapeHtml(chord)}</span><span class="lyric">&nbsp;</span></span>`;
      } else {
        html += `<span class="pair"><span class="chord" data-chord="${MT.escapeHtml(chord)}">${MT.escapeHtml(chord)}</span><span class="lyric">${escapeLyricForHtml(syllable)}</span></span>`;
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

      // ------------------------------------------------------------
      // 1. Section detection — supports [Section], # Section, and
      //    bare section names like "Verse 1", "Chorus", "Bridge 2".
      //    We also handle [Repeat: X] reference markers from
      //    ParserWeb if it's loaded.
      // ------------------------------------------------------------
      if (trimmed) {
        // [Section] or [Repeat: X]
        const bracketMatch = trimmed.match(/^\[([^\]]+)\]$/);
        if (bracketMatch) {
          const label = bracketMatch[1].trim();
          const repeatMatch = label.match(/^Repeat:\s*(.+)$/i);
          if (repeatMatch) {
            out.push(`<div class="section-reference"><i class="fas fa-redo"></i> Repeat ${MT.escapeHtml(repeatMatch[1].trim())}</div>`);
          } else {
            out.push(`<div class="section">${MT.escapeHtml(label)}</div>`);
          }
          i++;
          continue;
        }

        // Bare section names: "Verse 1", "Chorus", "# Verse 2", "## BRIDGE"
        // Only treat as a section if it's a SHORT line (under 40 chars)
        // AND not a chord line AND not something that reads like lyrics.
        if (trimmed.length <= 40 && !looksLikeChordLine(trimmed)) {
          // Use ParserFormats if available; fall back to a local check.
          let isSection = false;
          let normalizedName = trimmed;
          if (window.ParserFormats && typeof ParserFormats.parseSectionHeader === 'function') {
            const parsed = ParserFormats.parseSectionHeader(trimmed);
            if (parsed) {
              isSection = true;
              normalizedName = parsed.normalized;
            }
          } else {
            // Local fallback: keyword + short
            const upper = trimmed.toUpperCase().replace(/^#+\s*/, '');
            const keywords = ['VERSE','CHORUS','BRIDGE','PRE-CHORUS','PRECHORUS','PRE CHORUS','INTRO','OUTRO','TAG','ENDING','INSTRUMENTAL','INTERLUDE','REFRAIN','VAMP','TURNAROUND','SOLO','BREAKDOWN'];
            const firstWord = upper.split(/\s+/)[0];
            isSection = keywords.some(kw => upper === kw || upper.startsWith(kw + ' ') || firstWord === kw);
            if (isSection) {
              normalizedName = upper.split(/\s+/).map(w =>
                /^[0-9A-Z]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
              ).join(' ');
            }
          }

          if (isSection) {
            out.push(`<div class="section">${MT.escapeHtml(normalizedName)}</div>`);
            i++;
            continue;
          }
        }
      }

      if (trimmed === '') { i++; continue; }

      // ------------------------------------------------------------
      // 2. Chord line + following lyric line
      // ------------------------------------------------------------
      if (looksLikeChordLine(raw) && /[A-G]/.test(trimmed)) {
        const { direction } = extractPerformanceDirection(raw);
        const positions = parseChordPositions(raw);
        const nextLine = (i + 1 < lines.length) ? lines[i + 1] : '';
        const nextTrimmed = nextLine.trim();
        const nextIsChordLine = nextLine && looksLikeChordLine(nextLine) && /[A-G]/.test(nextTrimmed);

        // Also treat next line as "not a lyric" if it's a section header
        let nextIsSection = false;
        if (nextTrimmed) {
          if (/^\[[^\]]+\]$/.test(nextTrimmed)) nextIsSection = true;
          else if (nextTrimmed.length <= 40 && window.ParserFormats && ParserFormats.parseSectionHeader(nextTrimmed)) {
            nextIsSection = true;
          }
        }

        if (nextTrimmed !== '' && !nextIsChordLine && !nextIsSection) {
          out.push(buildLineHtml(positions, nextLine));
          if (direction) out.push(`<div class="direction">${MT.escapeHtml(direction)}</div>`);
          i += 2;
          continue;
        } else {
          // Instrumental / chord-only line
          const chordStr = positions
            .map(p => `<span class="chord" data-chord="${MT.escapeHtml(p.chord)}">${MT.escapeHtml(p.chord)}</span>`)
            .join('  ');
          out.push(`<div class="instr">${chordStr}</div>`);
          if (direction) out.push(`<div class="direction">${MT.escapeHtml(direction)}</div>`);
          i++;
          continue;
        }
      }

      // ------------------------------------------------------------
      // 3. Plain lyric line with no chords
      // ------------------------------------------------------------
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