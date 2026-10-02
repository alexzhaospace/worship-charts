// ============================================================
// parser-pdf.js — position-aware PDF extraction + SongSelect parser
// ============================================================
//
// Exposes `ParserPdf`. The main entry point is:
//
//   ParserPdf.parseFile(file) → Promise<Song[]>
//
// It reads a single PDF File/Blob and returns an array of song
// objects: { title, artist, key, chordSheet }.
//
// The parsing pipeline:
//   1. Extract text fragments from each page (pdf.js)
//   2. Detect column boundaries (for two-column SongSelect layouts)
//   3. Group fragments into visual lines by Y position
//   4. Classify each line (title, section, meta, footer, chords, body)
//   5. Segment lines into songs based on title-sized lines
//   6. Align chords over lyric syllables by X overlap
// ============================================================

window.ParserPdf = (function () {
  'use strict';

  const MT = window.MusicTheory;
  const PT = window.ParserText;
  const ParserFormats = window.ParserFormats;

  // ============================================================
  // STAGE 1: Extract fragments with positions
  // ============================================================
  function extractFragments(textContent) {
    const frags = [];
    textContent.items.forEach(it => {
      if (!it.str || it.str.trim() === '') return;
      const tr = it.transform;
      const h = Math.abs(tr[3]) || Math.abs(tr[0]) || 10;
      const fontName = (it.fontName || '').toLowerCase();
      const bold = /bold|black|heavy|semib/i.test(fontName);
      frags.push({
        str: it.str,
        x: tr[4],
        y: tr[5],
        width: it.width || 0,
        height: h,
        bold
      });
    });
    return frags;
  }

  // ============================================================
  // STAGE 2: Detect columns
  // ============================================================
  // SongSelect 2-column layouts have fragments clustered around two
  // X bands. Build a 1-D histogram of fragment starts and look for
  // a "gap" in the middle 30% of the page.
  function detectColumns(frags, pageWidth) {
    if (frags.length === 0) return [{ x0: 0, x1: pageWidth }];
    const xs = frags.map(f => f.x).sort((a, b) => a - b);
    const minX = xs[0], maxX = xs[xs.length - 1], span = maxX - minX;
    if (span <= 0) return [{ x0: minX, x1: maxX }];

    const bins = 40;
    const hist = new Array(bins).fill(0);
    frags.forEach(f => {
      const idx = Math.min(bins - 1, Math.floor(((f.x - minX) / span) * bins));
      hist[idx] += f.str.length;
    });

    const midLow = Math.floor(bins * 0.35);
    const midHigh = Math.floor(bins * 0.65);
    let bestGapIdx = -1, bestGapScore = Infinity;
    for (let i = midLow; i <= midHigh; i++) {
      if (hist[i] < bestGapScore) {
        bestGapScore = hist[i];
        bestGapIdx = i;
      }
    }

    const avg = hist.reduce((a, b) => a + b, 0) / bins;
    if (bestGapScore < avg * 0.35 && bestGapIdx > 0 && bestGapIdx < bins - 1) {
      const splitX = minX + (bestGapIdx / bins) * span;
      return [
        { x0: minX - 5, x1: splitX },
        { x0: splitX, x1: maxX + 5 }
      ];
    }
    return [{ x0: minX - 5, x1: maxX + 5 }];
  }

  // ============================================================
  // STAGE 3: Group fragments into visual lines
  // ============================================================
  function groupIntoLines(frags, column) {
    const inCol = frags.filter(f => f.x >= column.x0 && f.x < column.x1);
    if (inCol.length === 0) return [];

    inCol.sort((a, b) => b.y - a.y);

    const heights = inCol.map(f => f.height).sort((a, b) => a - b);
    const medianH = heights[Math.floor(heights.length / 2)] || 10;
    const yTolerance = medianH * 0.55;

    // ------------------------------------------------------------
    // STEP 1: Group fragments by Y into raw lines
    // ------------------------------------------------------------
    const rawLines = [];
    let current = null;
    inCol.forEach(f => {
      if (!current || Math.abs(f.y - current.y) > yTolerance) {
        if (current) rawLines.push(current);
        current = { y: f.y, frags: [f] };
      } else {
        current.frags.push(f);
        current.y = (current.y * (current.frags.length - 1) + f.y) / current.frags.length;
      }
    });
    if (current) rawLines.push(current);

    // ------------------------------------------------------------
    // STEP 2: Deduplicate + reconstruct each line
    // ------------------------------------------------------------
    const lines = rawLines.map(line => {
      // Sort by X
      line.frags.sort((a, b) => a.x - b.x);

      // Dedup overlapping fragments — a fragment whose X range is
      // entirely contained within another fragment's X range AND
      // whose text is a substring of that fragment is a duplicate.
      const deduped = [];
      line.frags.forEach(f => {
        const overlap = deduped.find(d => {
          const dStart = d.x;
          const dEnd = d.x + (d.width || 0);
          const fStart = f.x;
          const fEnd = f.x + (f.width || 0);
          // Overlap if fragments share > 60% of the smaller one's span
          const overlapStart = Math.max(dStart, fStart);
          const overlapEnd = Math.min(dEnd, fEnd);
          const overlapW = Math.max(0, overlapEnd - overlapStart);
          const minW = Math.max(0.1, Math.min(d.width, f.width));
          return overlapW / minW > 0.6;
        });
        if (overlap) {
          // Keep the longer string (usually the "real" one)
          if ((f.str || '').length > (overlap.str || '').length) {
            overlap.str = f.str;
            overlap.width = Math.max(overlap.width, f.width);
          }
          return;
        }
        deduped.push(f);
      });

      // --------------------------------------------------------
      // STEP 3: Compute character-width statistics
      // --------------------------------------------------------
      // We need a sense of how wide a single character is in this
      // line to judge whether a gap is a space or just glyph
      // tracking. Compute per-fragment average char width, then
      // take the median across the line.
      const charWidths = [];
      deduped.forEach(f => {
        const len = (f.str || '').length;
        if (len > 0 && f.width > 0) {
          charWidths.push(f.width / len);
        }
      });
      charWidths.sort((a, b) => a - b);
      const medianCharW = charWidths.length > 0
        ? charWidths[Math.floor(charWidths.length / 2)]
        : line.frags[0].height * 0.5;

      // A real space is roughly 0.35× the average character width.
      // A "tight" gap (no space) is under ~0.2×. We use three
      // thresholds:
      //   gap < TIGHT   → no space inserted
      //   gap < SPACE   → no space inserted (still tight)
      //   gap >= SPACE  → insert one space
      // Anything much larger → insert multiple spaces (proportional)
      const TIGHT = medianCharW * 0.15;
      const SPACE_THRESHOLD = medianCharW * 0.30;

      // --------------------------------------------------------
      // STEP 4: Reconstruct the line with adaptive spacing
      // --------------------------------------------------------
      let text = '';
      let prevEnd = null;
      let boldCount = 0;
      let totalHeight = 0;

      deduped.forEach(it => {
        if (prevEnd !== null) {
          const gap = it.x - prevEnd;
          if (gap > SPACE_THRESHOLD) {
            // Real space (or multiple)
            const numSpaces = Math.max(1, Math.min(12, Math.round(gap / medianCharW)));
            text += ' '.repeat(numSpaces);
          } else if (gap > TIGHT) {
            // Borderline — treat as tight (no space). This is where
            // the old code was inserting spurious spaces.
          }
          // gap <= TIGHT → nothing to add
        }
        text += it.str;
        prevEnd = it.x + (it.width || 0);
        if (it.bold) boldCount++;
        totalHeight += it.height;
      });

      return {
        y: line.y,
        frags: deduped,
        avgHeight: totalHeight / Math.max(1, deduped.length),
        boldCount,
        boldRatio: boldCount / Math.max(1, deduped.length),
        text: text.replace(/\s+$/, '')
      };
    });

    return lines;
  }

  // ============================================================
  // STAGE 4: Line classification
  // ============================================================
  const SECTION_KEYWORDS = [
    'VERSE', 'CHORUS', 'BRIDGE', 'PRE-CHORUS', 'PRECHORUS', 'PRE CHORUS',
    'INTRO', 'OUTRO', 'TAG', 'ENDING', 'INSTRUMENTAL', 'INTERLUDE',
    'REFRAIN', 'VAMP', 'TURNAROUND', 'SOLO', 'BREAKDOWN'
  ];

  function isCopyrightFooter(text) {
    return /^CCLI\s+Song/i.test(text) || /^©/i.test(text) ||
           /^For use solely/i.test(text) || /^www\./i.test(text) ||
           /^All rights reserved/i.test(text) || /SongSelect/i.test(text) ||
           /CCLI\s+License\s+#/i.test(text) || /^\d+\s+CCLI/i.test(text);
  }

  function isAttributionLine(text) {
    if (!text) return false;
    const t = text.trim();
    if (!/^\([^)]+\)$/.test(t)) return false;
    return /as\s+published|words\s+and\s+music|written\s+by|arranged\s+by|publishing|administered\s+by/i.test(t);
  }

  function classifyLine(line) {
    const t = (line.text || '').trim();
    if (!t) return 'blank';

    const upper = t.toUpperCase().replace(/\s+/g, ' ').trim();
    const firstWord = upper.split(/\s+/)[0];

    if (isAttributionLine(t)) return 'attribution';

    const startsWithParen = /^\s*\(/.test(t);

    // Try the format-agnostic section header parser.
    const parsed = ParserFormats.parseSectionHeader(t);
    if (parsed) {
      // Case 1: leading "#" — trust it completely
      if (parsed.hadHash) return 'section';

      // Case 2: bold or clearly larger text — also trust it
      if (!startsWithParen && (line.boldRatio > 0.5 || line.avgHeight > 9)) {
        return 'section';
      }

      // Case 3: no formatting clues — only treat as section if the
      // line is short (typical of section headers) AND contains no
      // verb-like content (i.e., it's not a lyric that happens to
      // start with "Verse"). Section headers are ≤ 4 words and
      // either contain a number or match an exact keyword.
      const wordCount = t.split(/\s+/).length;
      const hasNumber = /\d/.test(t);
      const isExactKeyword = SECTION_KEYWORDS.includes(upper);

      if (wordCount <= 4 && (hasNumber || isExactKeyword)) {
        return 'section';
      }
    }

    if (ParserFormats.looksLikeMetadata(t)) return 'meta';
    if (isCopyrightFooter(t)) return 'footer';
    if (PT.looksLikeChordOnlyLine(t)) return 'chords';
    return 'body';
  }

  // ============================================================
  // STAGE 5: Chord-over-lyric alignment
  // ============================================================
  // Given a chord line and the lyric line beneath it, associate
  // each chord with the syllable(s) whose X range falls under it.
  function alignChordLineWithLyric(chordLine, lyricLine) {
    if (!lyricLine) {
      return { pairs: chordLine.frags.map(f => ({ chord: f.str.trim(), lyric: '' })) };
    }

    // Collect chords with X positions
    const chords = [];
    chordLine.frags.forEach(f => {
      const s = f.str.trim();
      if (!s) return;
      const rawTokens = s.split(/\s+/).filter(Boolean);
      const mergedTokens = PT.mergeChordFragments(rawTokens);
      const totalLen = s.length;
      let cursor = f.x;
      mergedTokens.forEach(tk => {
        if (!tk) return;
        if (PT.looksLikeDirectionStart(tk)) return;
        const tkWidth = totalLen > 0 ? (tk.length / totalLen) * f.width : f.width / mergedTokens.length;
        if (MT.isStrictChord(tk)) {
          chords.push({ chord: tk, x0: cursor, x1: cursor + tkWidth });
        }
        cursor += tkWidth + (f.height * 0.28);
      });
    });

    if (chords.length === 0) return { pairs: [] };

    // Expand lyric fragments into per-character positions
    const lyricChars = [];
    lyricLine.frags.forEach(f => {
      const chars = f.str;
      const charW = f.width / Math.max(chars.length, 1);
      for (let i = 0; i < chars.length; i++) {
        lyricChars.push({ ch: chars[i], x: f.x + i * charW });
      }
    });

    const pairs = [];
    for (let i = 0; i < chords.length; i++) {
      const c = chords[i];
      const nextX = (i + 1 < chords.length) ? chords[i + 1].x0 : Infinity;
      const tol = (chordLine.avgHeight || 10) * 0.4;
      let startIdx = -1, endIdx = -1;
      for (let j = 0; j < lyricChars.length; j++) {
        const lx = lyricChars[j].x;
        if (startIdx === -1 && lx >= c.x0 - tol) startIdx = j;
        if (lx < nextX - tol) endIdx = j;
      }
      let syllable = '';
      if (startIdx !== -1 && endIdx >= startIdx) {
        syllable = lyricChars.slice(startIdx, endIdx + 1).map(lc => lc.ch).join('');
        syllable = syllable.replace(/^\s+/, '').replace(/\s+$/, '');
      }
      pairs.push({ chord: c.chord, lyric: syllable });
    }

    // Any leading lyric text before the first chord?
    if (chords.length > 0 && lyricChars.length > 0) {
      const firstChordX = chords[0].x0;
      const leading = lyricChars
        .filter(lc => lc.x < firstChordX - (chordLine.avgHeight || 10) * 0.4)
        .map(lc => lc.ch).join('').replace(/^\s+/, '');
      if (leading.trim()) pairs.unshift({ chord: '', lyric: leading });
    }

    // Any trailing lyric text after the last chord?
    if (chords.length > 0 && lyricChars.length > 0) {
      const lastChordEnd = chords[chords.length - 1].x1;
      const trailing = lyricChars
        .filter(lc => lc.x >= lastChordEnd)
        .map(lc => lc.ch).join('').replace(/\s+$/, '');
      if (trailing.trim()) {
        const last = pairs[pairs.length - 1];
        if (last && !last.lyric) last.lyric = trailing.replace(/^\s+/, '');
        else pairs.push({ chord: '', lyric: trailing.replace(/^\s+/, '') });
      }
    }

    return { pairs };
  }

  // ============================================================
  // STAGE 6: HTML builders
  // ============================================================
  function renderLineFromPairs(pairs) {
    if (!pairs || pairs.length === 0) return '';
    const esc = MT.escapeHtml;
    const escL = PT.escapeLyricForHtml;
    let html = '<div class="line">';
    pairs.forEach(p => {
      const chord = p.chord || '';
      const lyric = p.lyric || '';
      if (!chord && !lyric) return;
      if (!chord) {
        html += `<span class="pair"><span class="chord empty">&nbsp;</span><span class="lyric">${escL(lyric)}</span></span>`;
      } else if (!lyric) {
        html += `<span class="pair"><span class="chord" data-chord="${esc(chord)}">${esc(chord)}</span><span class="lyric">&nbsp;</span></span>`;
      } else {
        html += `<span class="pair"><span class="chord" data-chord="${esc(chord)}">${esc(chord)}</span><span class="lyric">${escL(lyric)}</span></span>`;
      }
    });
    html += '</div>';
    return html;
  }

  function buildSongFromLines(lines) {
    const esc = MT.escapeHtml;
    const escL = PT.escapeLyricForHtml;
    const html = [];
    let i = 0;

    const hasSection = lines.some(l => classifyLine(l) === 'section');
    if (!hasSection) html.push(`<div class="section">Song</div>`);

    const footerLines = [];

    while (i < lines.length) {
      const line = lines[i];
      const kind = classifyLine(line);

      if (kind === 'blank') { i++; continue; }

      if (kind === 'section') {
        html.push(`<div class="section">${esc(line.text.trim())}</div>`);
        i++;
        continue;
      }

      if (kind === 'attribution') {
        html.push(`<div class="attribution">${esc(line.text.trim())}</div>`);
        i++;
        continue;
      }

      if (kind === 'footer') {
        while (i < lines.length && classifyLine(lines[i]) === 'footer') {
          footerLines.push((lines[i].text || '').trim());
          i++;
        }
        continue;
      }

      if (kind === 'meta') { i++; continue; }

      if (kind === 'chords') {
        let nextIdx = i + 1;
        while (nextIdx < lines.length && classifyLine(lines[nextIdx]) === 'blank') nextIdx++;
        const nextLine = (nextIdx < lines.length) ? lines[nextIdx] : null;
        const nextKind = nextLine ? classifyLine(nextLine) : 'blank';
        const { direction } = PT.extractPerformanceDirection(line.text || '');

        if (nextKind === 'body') {
          const { pairs } = alignChordLineWithLyric(line, nextLine);
          html.push(renderLineFromPairs(pairs));
          if (direction) html.push(`<div class="direction">${esc(direction)}</div>`);
          i = nextIdx + 1;
          continue;
        }

        // Instrumental / chord-only line
        const chordText = line.frags.map(f => f.str.trim()).filter(Boolean).join(' ');
        const merged = PT.mergeChordFragments(chordText.split(/\s+/).filter(Boolean));
        const chordHtml = merged
          .filter(MT.isStrictChord)
          .map(c => `<span class="chord" data-chord="${esc(c)}">${esc(c)}</span>`)
          .join('  ');
        if (chordHtml) html.push(`<div class="instr">${chordHtml}</div>`);
        if (direction) html.push(`<div class="direction">${esc(direction)}</div>`);
        i++;
        continue;
      }

      if (kind === 'body') {
        const text = line.frags.map(f => f.str).join(' ').replace(/\s+/g, ' ').trim();
        html.push(`<div class="line"><span class="pair"><span class="chord empty">&nbsp;</span><span class="lyric">${escL(text)}</span></span></div>`);
        i++;
        continue;
      }

      i++;
    }

    if (footerLines.length > 0) {
      html.push(`<div class="copyright">`);
      footerLines.forEach(fl => html.push(`<span class="copyright-row">${esc(fl)}</span>`));
      html.push(`</div>`);
    }

    return html.join('\n');
  }

  // ============================================================
  // STAGE 7: Metadata extraction
  // ============================================================
  function extractMetadata(line) {
    return ParserFormats.parseMetadataLine(line);
  }

  // ============================================================
  // STAGE 8: Song segmentation
  // ============================================================
  function segmentIntoAllSongs(blocks) {
    const flatLines = [];
    blocks.forEach(b => {
      b.lines.forEach(l => {
        flatLines.push({ ...l, pageNum: b.pageNum, columnIndex: b.columnIndex });
      });
    });

    if (flatLines.length === 0) return [];

    // ------------------------------------------------------------
    // STEP 1: Detect title candidates
    // ------------------------------------------------------------
    // Use a MUCH tighter threshold than before: a title must be
    // within 5% of the largest font on the page. This is critical
    // for PDFs where the title font isn't dramatically bigger than
    // the body (Psalmnote, hand-typed exports, etc.).
    const heights = flatLines.map(l => l.avgHeight).filter(h => h > 0);
    const maxH = Math.max(...heights, 12);
    const titleThreshold = maxH * 0.95;

    const titleCandidates = [];
    flatLines.forEach((line, idx) => {
      const kind = classifyLine(line);
      // Never treat sections, chords, footers, or attributions as titles
      if (kind === 'section' || kind === 'chords' ||
          kind === 'footer' || kind === 'attribution') return;
      // Never treat metadata as a title
      if (kind === 'meta') return;
      const t = (line.text || '').trim();
      if (!t) return;
      // Must be title-sized
      if (line.avgHeight < titleThreshold) return;
      // Must not be too long (a title is usually under 60 chars)
      if (t.length > 60) return;
      titleCandidates.push(idx);
    });

    // ------------------------------------------------------------
    // STEP 2: Filter title candidates
    // ------------------------------------------------------------
    // Two filters:
    //   (a) Collapse clusters of adjacent candidates — only keep
    //       the first one. A "cluster" is candidates within 3 lines
    //       of each other. This prevents a 2-line title from being
    //       counted as two songs.
    //   (b) Enforce a minimum distance of 6 lines between two
    //       accepted titles. Shorter intervals are almost always
    //       a body line that happens to be title-sized.

    const MIN_DISTANCE = 6;
    const CLUSTER_DISTANCE = 3;

    const accepted = [];
    let lastAccepted = -Infinity;

    titleCandidates.forEach(idx => {
      if (accepted.length === 0) {
        accepted.push(idx);
        lastAccepted = idx;
        return;
      }

      const distance = idx - lastAccepted;

      // Within cluster range? Skip (part of the same title block)
      if (distance <= CLUSTER_DISTANCE) return;

      // Within minimum distance? Skip (likely a false positive)
      if (distance < MIN_DISTANCE) return;

      accepted.push(idx);
      lastAccepted = idx;
    });

    // ------------------------------------------------------------
    // STEP 3: Fallback — if no titles were found, treat as one song
    // ------------------------------------------------------------
    if (accepted.length === 0) {
      const html = buildSongFromLines(flatLines);
      const inferred = MT.inferKeyFromHtml(html) || 'C';
      return [{
        title: (flatLines[0].text || 'Untitled').trim().slice(0, 60),
        artist: 'Unknown',
        key: inferred,
        chordSheet: html
      }];
    }

    // ------------------------------------------------------------
    // STEP 4: Segment into songs
    // ------------------------------------------------------------
    const songs = [];
    for (let i = 0; i < accepted.length; i++) {
      const start = accepted[i];
      const end = (i + 1 < accepted.length) ? accepted[i + 1] : flatLines.length;
      const titleLine = flatLines[start];
      const title = (titleLine.text || 'Untitled').trim().slice(0, 60);

      // Look ahead up to 3 non-blank lines for metadata (artist + key).
      let metaLine = '';
      let bodyStart = start + 1;
      let j = start + 1;
      let linesChecked = 0;
      const metaCandidates = [];

      while (j < end && linesChecked < 3) {
        const candidate = flatLines[j];
        const candidateKind = classifyLine(candidate);
        const candidateText = (candidate.text || '').trim();

        if (!candidateText) { j++; continue; }
        if (candidateKind === 'section') break;
        if (candidateKind === 'chords') break;
        if (candidateKind === 'footer') break;
        if (candidateKind === 'attribution') { linesChecked++; j++; continue; }

        if (candidateKind === 'meta') {
          metaCandidates.push(candidateText);
          linesChecked++;
          j++;
          continue;
        }

        // Heuristic: a line right after a title that contains "|" or
        // commas and reads like names is likely the artist line.
        const looksLikeArtist =
          /[A-Za-z]/.test(candidateText) &&
          candidate.avgHeight < titleLine.avgHeight * 1.15 &&
          (
            candidateText.includes('|') ||
            /^[A-Z][a-zA-Z.'&\- ]+(?:\s*[|/]\s*[A-Z][a-zA-Z.'&\- ]+)*$/.test(candidateText)
          );

        if (looksLikeArtist) {
          metaCandidates.push(candidateText);
          linesChecked++;
          j++;
          continue;
        }
        break;
      }

      if (metaCandidates.length > 0) {
        metaLine = metaCandidates.join(' ');
        bodyStart = j;
      } else {
        bodyStart = start + 1;
        while (bodyStart < end && classifyLine(flatLines[bodyStart]) === 'blank') bodyStart++;
      }

      const bodyLines = [];
      for (let k = bodyStart; k < end; k++) bodyLines.push(flatLines[k]);

      const meta = metaLine ? extractMetadata(metaLine) : { artist: '', key: '' };
      const html = buildSongFromLines(bodyLines);

      // Key resolution: metadata → scan → infer → C
      let songKey = meta.key;
      if (!songKey) {
        const allText = bodyLines.map(l => l.text).join(' ') + ' ' + metaLine;
        const keyFromScan = allText.match(/\bKey\s*[-:]\s*([A-G][#b]?m?)/i);
        if (keyFromScan) songKey = keyFromScan[1].trim();
      }
      if (!songKey) songKey = MT.inferKeyFromHtml(html);
      if (!songKey) songKey = 'C';

      songs.push({
        title,
        artist: meta.artist || 'Unknown',
        key: songKey,
        chordSheet: html
      });
    }

    return songs;
  }

  // ============================================================
  // MAIN ENTRY: parse a single PDF File/Blob
  // ============================================================
  async function parseFile(file) {
    if (!window.pdfjsLib) throw new Error('PDF library (pdf.js) failed to load.');
    if (!file) throw new Error('No file provided.');

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const allBlocks = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const frags = extractFragments(textContent);
      if (frags.length === 0) continue;

      const columns = detectColumns(frags, viewport.width);
      columns.sort((a, b) => a.x0 - b.x0);
      columns.forEach((col, colIdx) => {
        const lines = groupIntoLines(frags, col);
        if (lines.length > 0) {
          allBlocks.push({ lines, pageNum, columnIndex: colIdx });
        }
      });
    }

    return segmentIntoAllSongs(allBlocks);
  }

  return {
    parseFile,
    // Exposed for testing / advanced use
    extractFragments,
    detectColumns,
    groupIntoLines,
    classifyLine,
    segmentIntoAllSongs,
    buildSongFromLines,
    alignChordLineWithLyric
  };
})();