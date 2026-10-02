// ============================================================
// render.js — chord sheet rendering pipeline
// ============================================================
//
// Exposes `Render`. Handles the transformation from a raw song
// (with data-chord attributes) to a displayed chord sheet with
// transpose, capo, and Nashville mode applied.
//
// The pipeline reads from `data-chord` on every render, so it's
// idempotent — calling it repeatedly never compounds transforms.
// ============================================================

window.Render = (function () {
  'use strict';

  const MT = window.MusicTheory;

  // ------------------------------------------------------------
  // STAMP ORIGINAL CHORDS
  // ------------------------------------------------------------
  // Every `.chord` element must carry a `data-chord` attribute
  // holding its original letter chord. This gives us a stable
  // source of truth across re-renders.
  function stampOriginalChords(rootEl) {
    rootEl.querySelectorAll('.chord').forEach(el => {
      if (el.hasAttribute('data-chord')) return;
      const text = el.textContent.trim();
      if (!text) return;
      el.setAttribute('data-chord', text);
    });
  }

  // ------------------------------------------------------------
  // RENDER OPTIONS
  // ------------------------------------------------------------
  // opts: { shift, capo, mode }
  //   shift — semitones above the song's original key
  //   capo  — fret position (0 = no capo)
  //   mode  — 'letters' | 'nashville'
  //
  // Returns the target key info { name, preferFlats, pc }.
  // ------------------------------------------------------------
  function renderChordSheetInto(song, targetEl, opts) {
    const shift = opts?.shift ?? 0;
    const capo = opts?.capo ?? 0;
    const mode = opts?.mode ?? 'letters';

    targetEl.innerHTML = song.chordSheet;
    stampOriginalChords(targetEl);

    const target = MT.computeTargetKey(song, shift);
    const shapeKey = MT.computeCapoShapeKey(song, shift, capo);
    const nashvilleRefPc = shapeKey.pc;

    targetEl.querySelectorAll('.chord').forEach(el => {
      const original = el.getAttribute('data-chord');
      if (!original) return;

      // 1. Transpose from original key to sounding key
      let sounding = MT.transposeChord(original, shift, target.preferFlats);

      // 2. Apply capo — shift down to shape chord
      let shape = sounding;
      if (capo > 0) {
        shape = MT.transposeChord(sounding, -capo, shapeKey.preferFlats);
      }

      // 3. Render in the requested mode
      if (mode === 'nashville') {
        const nashville = MT.chordToNashville(shape, nashvilleRefPc);
        el.innerHTML = MT.renderNashvilleHtml(nashville);
        el.classList.add('nashville');
      } else {
        el.innerHTML = MT.renderChordHtml(shape);
        el.classList.remove('nashville');
      }
    });

    return target;
  }

  // ------------------------------------------------------------
  // BUILD A TRANSFORMED CLONE (for PDF export)
  // ------------------------------------------------------------
  // Returns a detached clone with all chord text already replaced
  // by its final displayed form. Used by PdfExport.
  function buildTransformedClone(song, opts) {
    const shift = opts?.shift ?? 0;
    const capo = opts?.capo ?? 0;
    const mode = opts?.mode ?? 'letters';

    const clone = document.createElement('div');
    clone.innerHTML = song.chordSheet;
    stampOriginalChords(clone);

    const target = MT.computeTargetKey(song, shift);
    const shapeKey = MT.computeCapoShapeKey(song, shift, capo);
    const nashvilleRefPc = shapeKey.pc;

    clone.querySelectorAll('.chord').forEach(el => {
      const original = el.getAttribute('data-chord');
      if (!original) return;

      let sounding = MT.transposeChord(original, shift, target.preferFlats);
      let shape = sounding;
      if (capo > 0) {
        shape = MT.transposeChord(sounding, -capo, shapeKey.preferFlats);
      }

      if (mode === 'nashville') {
        el.textContent = MT.chordToNashville(shape, nashvilleRefPc);
        el.classList.add('nashville');
      } else {
        el.textContent = shape;
        el.classList.remove('nashville');
      }
    });

    return { clone, target, shapeKey };
  }

  // ------------------------------------------------------------
  // EXTRACT BLOCKS FOR PDF EXPORT
  // ------------------------------------------------------------
  // Walk a chord sheet DOM and produce a flat list of "blocks"
  // describing each visual row for jsPDF.
  function extractChordSheetBlocks(rootEl) {
    const blocks = [];
    rootEl.childNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      const cls = node.classList;

      if (cls.contains('section')) {
        blocks.push({ type: 'section', text: node.textContent.trim() });
      } else if (cls.contains('direction')) {
        blocks.push({ type: 'direction', text: node.textContent.trim() });
      } else if (cls.contains('attribution')) {
        blocks.push({ type: 'attribution', text: node.textContent.trim() });
      } else if (cls.contains('copyright')) {
        const rows = [];
        node.querySelectorAll('.copyright-row').forEach(r => {
          const t = r.textContent.trim();
          if (t) rows.push(t);
        });
        if (rows.length === 0) rows.push(node.textContent.trim());
        blocks.push({ type: 'copyright', rows });
      } else if (cls.contains('instr')) {
        blocks.push({
          type: 'instr',
          text: node.textContent.replace(/\s+/g, ' ').trim(),
          nashville: node.classList.contains('nashville')
        });
      } else if (cls.contains('line')) {
        const pairs = [];
        node.querySelectorAll('.pair').forEach(pair => {
          const chordEl = pair.querySelector('.chord');
          const lyricEl = pair.querySelector('.lyric');
          let chord = chordEl ? chordEl.textContent : '';
          let lyric = lyricEl ? lyricEl.textContent : '';
          const isNashville = chordEl && chordEl.classList.contains('nashville');
          chord = chord.replace(/\u00a0/g, ' ').trim();
          lyric = lyric.replace(/\u00a0/g, ' ');
          if (chord === '\u00a0' || chord === '') chord = '';
          pairs.push({ chord, lyric, nashville: isNashville });
        });
        blocks.push({ type: 'line', pairs });
      }
    });
    return blocks;
  }

  return {
    stampOriginalChords,
    renderChordSheetInto,
    buildTransformedClone,
    extractChordSheetBlocks
  };
})();