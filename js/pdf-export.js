// ============================================================
// pdf-export.js — jsPDF export for single songs and setlists
// ============================================================
//
// Exposes `PdfExport` with three main functions:
//   exportSong(song, opts)       → Promise<void>  (triggers download)
//   exportSetlist(setlist, songs, opts) → Promise<void>
//   isReady()                    → bool
//
// `opts` for both: { shift, capo, mode }
// ============================================================

window.PdfExport = (function () {
  'use strict';

  const MT = window.MusicTheory;
  const Render = window.Render;

  // ------------------------------------------------------------
  // CONSTANTS
  // ------------------------------------------------------------
  const CHORD_SIZE = 10;
  const LYRIC_SIZE = 11.5;
  const SECTION_SIZE = 11;
  const DIRECTION_SIZE = 9.5;
  const COPYRIGHT_SIZE = 8.5;
  const PT_TO_MM = 0.3528;

  const chordLineH    = CHORD_SIZE * PT_TO_MM * 1.15;
  const lyricLineH    = LYRIC_SIZE * PT_TO_MM * 1.25;
  const sectionLineH  = SECTION_SIZE * PT_TO_MM * 1.5;
  const directionLineH = DIRECTION_SIZE * PT_TO_MM * 1.5;
  const copyrightLineH = COPYRIGHT_SIZE * PT_TO_MM * 1.5;

  const gapAfterLine       = 2.6;
  const gapBeforeSection   = 5.0;
  const gapAfterSection    = 1.8;
  const gapAfterDirection  = 2.0;
  const gapBeforeCopyright = 6.0;

  function isReady() {
    return !!(window.jspdf && window.jspdf.jsPDF);
  }

  // ------------------------------------------------------------
  // LOW-LEVEL DRAWING
  // ------------------------------------------------------------
  function drawSongHeader(doc, song, target, shapeKey, shift, capo, mode, opts) {
    const marginL = opts.marginL, marginR = opts.marginR;
    const pageWidth = doc.internal.pageSize.getWidth();
    let headerY = opts.startY;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(opts.titleSize || 20);
    doc.setTextColor(30, 43, 54);
    const titleLines = doc.splitTextToSize(song.title, pageWidth - marginL - marginR);
    titleLines.forEach(ln => {
      doc.text(ln, marginL, headerY);
      headerY += 7.5;
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(110, 94, 79);

    const shiftLabel = shift === 0
      ? 'original key'
      : `${shift > 0 ? '+' : '−'}${Math.abs(shift)} semitone${Math.abs(shift) === 1 ? '' : 's'}`;

    let metaLine = `Artist: ${song.artist || '—'}   •   Key: ${target.name}`;
    if (capo > 0) metaLine += `   •   Capo ${capo} (play ${shapeKey.name} shapes)`;
    metaLine += `   •   ${mode === 'nashville' ? 'Nashville Numbers' : 'Letter Chords'}   •   ${shiftLabel}`;

    const metaLines = doc.splitTextToSize(metaLine, pageWidth - marginL - marginR);
    metaLines.forEach(ln => {
      doc.text(ln, marginL, headerY);
      headerY += 5;
    });

    headerY += 1.5;
    doc.setDrawColor(77, 107, 128);
    doc.setLineWidth(0.6);
    doc.line(marginL, headerY, pageWidth - marginR, headerY);
    headerY += 6;

    return headerY;
  }

  function drawBlocks(doc, blocks, opts) {
    const pageWidth  = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginL = opts.marginL, marginR = opts.marginR, marginB = opts.marginB;
    const usableW = pageWidth - marginL - marginR;
    let y = opts.startY;

    function ensureSpace(needed) {
      if (y + needed > pageHeight - marginB) {
        doc.addPage();
        y = opts.marginT;
      }
    }
    function measure(text, size, style) {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      return doc.getTextWidth(text);
    }

    blocks.forEach(block => {
      if (block.type === 'section') {
        ensureSpace(sectionLineH + gapBeforeSection + gapAfterSection);
        y += gapBeforeSection;
        doc.setFillColor(161, 61, 47);
        doc.rect(marginL, y - 2.5, 1.4, sectionLineH * 0.8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(SECTION_SIZE);
        doc.setTextColor(61, 50, 38);
        doc.text(block.text.toUpperCase(), marginL + 4, y);
        doc.setDrawColor(227, 219, 210);
        doc.setLineWidth(0.25);
        doc.setLineDashPattern([1, 1], 0);
        doc.line(marginL + 4, y + 1.4, marginL + usableW, y + 1.4);
        doc.setLineDashPattern([], 0);
        y += gapAfterSection + sectionLineH;
        return;
      }
      if (block.type === 'direction' || block.type === 'attribution') {
        ensureSpace(directionLineH + gapAfterDirection);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(DIRECTION_SIZE);
        doc.setTextColor(138, 119, 103);
        doc.text(block.text, marginL + 3, y);
        y += gapAfterDirection + directionLineH;
        return;
      }
      if (block.type === 'copyright') {
        ensureSpace(gapBeforeCopyright + copyrightLineH * block.rows.length + 2);
        y += gapBeforeCopyright;
        doc.setDrawColor(200, 190, 178);
        doc.setLineWidth(0.2);
        doc.line(marginL, y, marginL + usableW, y);
        y += 3;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(COPYRIGHT_SIZE);
        doc.setTextColor(138, 119, 103);
        block.rows.forEach(row => {
          const lines = doc.splitTextToSize(row, usableW);
          lines.forEach(ln => {
            ensureSpace(copyrightLineH);
            doc.text(ln, marginL, y);
            y += copyrightLineH;
          });
        });
        return;
      }
      if (block.type === 'instr') {
        ensureSpace(lyricLineH + gapAfterLine);
        doc.setFont('courier', 'bold');
        doc.setFontSize(LYRIC_SIZE);
        doc.setTextColor(
          block.nashville ? 44 : 161,
          block.nashville ? 91 : 61,
          block.nashville ? 122 : 47
        );
        const lines = doc.splitTextToSize(block.text, usableW);
        lines.forEach(ln => {
          ensureSpace(lyricLineH);
          doc.text(ln, marginL, y);
          y += lyricLineH;
        });
        y += gapAfterLine;
        return;
      }
      if (block.type === 'line') {
        let cursorX = marginL;
        let pairBaselineY = y;
        let maxRowHeight = 0;

        const flushRow = () => {
          if (maxRowHeight > 0) {
            y = pairBaselineY + maxRowHeight;
            maxRowHeight = 0;
          }
        };

        block.pairs.forEach(pair => {
          const chordText = pair.chord || '';
          const lyricText = pair.lyric || '';
          const chordW = chordText ? measure(chordText, CHORD_SIZE, 'bold') : 0;
          const lyricW = lyricText ? measure(lyricText, LYRIC_SIZE, 'normal') : 0;
          const pairW = Math.max(chordW, lyricW);
          const spacing = 0.6;

          if (cursorX > marginL && cursorX + pairW > marginL + usableW) {
            flushRow();
            ensureSpace(chordLineH + lyricLineH + gapAfterLine);
            pairBaselineY = y;
            cursorX = marginL;
          }
          if (maxRowHeight === 0) {
            ensureSpace(chordLineH + lyricLineH + gapAfterLine);
          }
          if (chordText) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(CHORD_SIZE);
            if (pair.nashville) doc.setTextColor(44, 91, 122);
            else doc.setTextColor(161, 61, 47);
            doc.text(chordText, cursorX, pairBaselineY + chordLineH * 0.85);
          }
          if (lyricText) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(LYRIC_SIZE);
            doc.setTextColor(35, 32, 29);
            doc.text(lyricText, cursorX, pairBaselineY + chordLineH + lyricLineH * 0.85);
          }
          const thisH = chordLineH + lyricLineH;
          if (thisH > maxRowHeight) maxRowHeight = thisH;
          cursorX += pairW + spacing;
        });

        flushRow();
        y += gapAfterLine;
        return;
      }
    });

    return y;
  }

  function addPageFooters(doc, footerText, marginL, marginR) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      const ph = doc.internal.pageSize.getHeight();
      const fw = doc.internal.pageSize.getWidth();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(162, 140, 122);
      doc.text(footerText, fw / 2, ph - 12, { align: 'center' });
      doc.text(`Page ${p} of ${pageCount}`, fw - marginR, ph - 12, { align: 'right' });
      doc.setDrawColor(227, 219, 210);
      doc.setLineWidth(0.2);
      doc.line(marginL, ph - 16, fw - marginR, ph - 16);
    }
  }

  // ------------------------------------------------------------
  // FILENAME HELPERS
  // ------------------------------------------------------------
  function sanitizeFilenamePart(s) {
    return String(s).replace(/[^\w\-. ()]+/g, '').trim().replace(/\s+/g, '_');
  }

  function buildSongFilename(song, opts) {
    const target = MT.computeTargetKey(song, opts.shift ?? 0);
    const shapeKey = MT.computeCapoShapeKey(song, opts.shift ?? 0, opts.capo ?? 0);
    const mode = (opts.mode ?? 'letters') === 'nashville' ? 'NNS' : 'Letters';
    const capoPart = (opts.capo ?? 0) > 0
      ? `_Capo${opts.capo}_(${shapeKey.name}shapes)`
      : '';
    const base = `${song.title} - ${target.name}${capoPart} - ${mode}`;
    return sanitizeFilenamePart(base) + '.pdf';
  }

  // ------------------------------------------------------------
  // PUBLIC: EXPORT A SINGLE SONG
  // ------------------------------------------------------------
  async function exportSong(song, opts) {
    if (!isReady()) throw new Error('The PDF library failed to load.');
    if (!song) throw new Error('No song to export.');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      unit: 'mm', format: 'a4', orientation: 'portrait', compress: true
    });

    const marginL = 18, marginR = 18, marginT = 20, marginB = 22;

    const { clone, target, shapeKey } = Render.buildTransformedClone(song, opts);
    const blocks = Render.extractChordSheetBlocks(clone);

    const headerEndY = drawSongHeader(doc, song, target, shapeKey,
      opts.shift ?? 0, opts.capo ?? 0, opts.mode ?? 'letters',
      { marginL, marginR, startY: marginT });

    drawBlocks(doc, blocks, { marginL, marginR, marginT, marginB, startY: headerEndY });

    const today = new Date().toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    addPageFooters(doc, `Rendered by Worship Charts · ${today}`, marginL, marginR);

    doc.save(buildSongFilename(song, opts));
  }

  // ------------------------------------------------------------
  // PUBLIC: EXPORT A SETLIST
  // ------------------------------------------------------------
  // `items` is an array of { song, key, capo, notes } — where
  // `song` is the resolved song object. The caller (app.js) does
  // the lookup so this module stays decoupled from state.
  async function exportSetlist(setlist, items, opts) {
    if (!isReady()) throw new Error('The PDF library failed to load.');
    if (!setlist || !items || items.length === 0) throw new Error('No songs to export.');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      unit: 'mm', format: 'a4', orientation: 'portrait', compress: true
    });

    const marginL = 18, marginR = 18, marginT = 20, marginB = 22;
    const pageWidth = doc.internal.pageSize.getWidth();
    const displayMode = opts?.mode ?? 'letters';

    let firstSongOnPage = true;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const song = item.song;
      if (!song) continue;

      // Per-item override logic
      const songKey = item.key || song.key || 'C';
      const capo = item.capo || 0;
      const origPc = MT.NOTE_TO_PC[song.key] ?? 0;
      const targetPc = MT.NOTE_TO_PC[songKey];
      let shift = 0;
      if (targetPc !== undefined) {
        shift = (targetPc - origPc + 120) % 12;
        if (shift > 6) shift -= 12;
      }

      const { clone, target, shapeKey } = Render.buildTransformedClone(song, {
        shift, capo, mode: displayMode
      });
      const blocks = Render.extractChordSheetBlocks(clone);

      if (!firstSongOnPage) doc.addPage();
      firstSongOnPage = false;

      const headerEndY = drawSongHeader(doc, song, target, shapeKey, shift, capo, displayMode, {
        marginL, marginR, startY: marginT, titleSize: 17
      });

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(162, 140, 122);
      doc.text(
        `Song ${i + 1} of ${items.length}${item.notes ? ' · ' + item.notes : ''}`,
        pageWidth - marginR, marginT - 4, { align: 'right' }
      );

      drawBlocks(doc, blocks, { marginL, marginR, marginT, marginB, startY: headerEndY });
    }

    const today = new Date().toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    addPageFooters(doc, `${setlist.name} · Rendered by Worship Charts · ${today}`, marginL, marginR);

    const safeName = sanitizeFilenamePart(setlist.name);
    const datePart = new Date().toISOString().slice(0, 10);
    doc.save(`${safeName}_${datePart}.pdf`);
  }

  return {
    isReady,
    exportSong,
    exportSetlist
  };
})();