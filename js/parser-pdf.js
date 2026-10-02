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

    const lines = [];
    let current = null;
    inCol.forEach(f => {
      if (!current || Math.abs(f.y - current.y) > yTolerance) {
        if (current) lines.push(current);
        current = { y: f.y, frags: [f] };
      } else {
        current.frags.push(f);
        current.y = (current.y * (current.frags.length - 1) + f.y) / current.frags.length;
      }
    });
    if (current) lines.push(current);

    lines.forEach(line => {
      line.frags.sort((a, b) => a.x - b.x);
      const hs = line.frags.map(f => f.height);
      line.avgHeight = hs.reduce((a, b) => a + b, 0) / hs.length;
      line.boldCount = line.frags.filter(f => f.bold).length;
      line.boldRatio = line.boldCount / line.frags.length;
      line.text = line.frags.map(f => f.str).join(' ').trim();
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

    // Never treat a line that starts with "(" as a section header
    const startsWithParen = /^\s*\(/.test(t);

    const isSection =
      !startsWithParen &&
      line.boldRatio > 0.6 &&
      line.avgHeight > 8 &&
      SECTION_KEYWORDS.some(kw =>
        upper === kw || upper.startsWith(kw + ' ') || firstWord === kw);

    if (isSection) return 'section';
    if (/Key\s*[-:]|Tempo\s*[-:]|Time\s*[-:]|\|\s*(Time|Tempo|Key)/i.test(t)) return 'meta';
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
    const meta = { artist: '', key: '' };

    const keyMatch = line.match(/Key\s*[-:]\s*([A-G][#b]?m?)/i);
    if (keyMatch) meta.key = keyMatch[1].trim();

    let artistPart = line;
    const cutPoints = [
      line.search(/Key\s*[-:]/i),
      line.search(/\|\s*Tempo\s*[-:]/i),
      line.search(/\|\s*Time\s*[-:]/i),
      line.search(/Tempo\s*[-:]/i),
      line.search(/Time\s*[-:]/i)
    ].filter(i => i >= 0).sort((a, b) => a - b);

    if (cutPoints.length > 0) {
      artistPart = line.slice(0, cutPoints[0]);
    }

    artistPart = artistPart.replace(/\s*\|\s*$/, '').trim();
    artistPart = artistPart.replace(/\s*\(as published[^)]*\)/i, '');
    artistPart = artistPart.replace(/\s*\(as published by[^)]*\)/i, '');
    artistPart = artistPart.replace(/\s+/g, ' ').trim();
    artistPart = artistPart.replace(/^#+\s*/, '').trim();
    artistPart = artistPart.replace(/^\d+\s+/, '').trim();

    meta.artist = artistPart;
    return meta;
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

    // Detect title lines: the largest font size on the page.
    const heights = flatLines.map(l => l.avgHeight).filter(h => h > 0);
    const maxH = Math.max(...heights, 12);
    const titleThreshold = maxH * 0.82;

    const titleIdxs = [];
    flatLines.forEach((line, idx) => {
      const kind = classifyLine(line);
      if (kind === 'section' || kind === 'chords' || kind === 'footer' || kind === 'attribution') return;
      const t = (line.text || '').trim();
      if (!t) return;
      if (line.avgHeight >= titleThreshold) titleIdxs.push(idx);
    });

    // Fallback: if we can't find any title, treat the whole doc as one song.
    if (titleIdxs.length === 0) {
      const html = buildSongFromLines(flatLines);
      const inferred = MT.inferKeyFromHtml(html) || 'C';
      return [{
        title: (flatLines[0].text || 'Untitled').trim(),
        artist: 'Unknown',
        key: inferred,
        chordSheet: html
      }];
    }

    const songs = [];
    for (let i = 0; i < titleIdxs.length; i++) {
      const start = titleIdxs[i];
      const end = (i + 1 < titleIdxs.length) ? titleIdxs[i + 1] : flatLines.length;
      const titleLine = flatLines[start];
      const title = (titleLine.text || 'Untitled').trim();

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

        // Heuristic: a line that looks like an artist name
        const looksLikeArtist =
          /[A-Za-z]/.test(candidateText) &&
          candidate.avgHeight < titleLine.avgHeight * 1.1 &&
          (candidateText.includes('|') ||
           /^[A-Z][a-zA-Z.'&\- ]+(?:\s*[|/]\s*[A-Z][a-zA-Z.'&\- ]+)*$/.test(candidateText));

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

      // Key resolution: metadata → scan whole block → infer from chords → C
      let songKey = meta.key;
      if (!songKey) {
        const allText = bodyLines.map(l => l.text).join(' ') + ' ' + metaLine;
        const keyFromScan = allText.match(/Key\s*[-:]\s*([A-G][#b]?m?)/i);
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