// ============================================================
// paste-chords.js — the "Paste Chords" modal
// ============================================================
//
// Exposes `PasteChords.open(songId, onDone)`.
//
// Opens a modal letting the user paste a chord sheet as text.
// Reuses ParserText.plainTextToHtml to convert it, then updates
// the song via Songs.update().
//
// onDone — optional callback fired after a successful replace.
// ============================================================

window.PasteChords = (function () {
  'use strict';

  const MT = window.MusicTheory;
  const PT = window.ParserText;
  const Songs = window.Songs;

  let currentSongId = null;
  let onDoneCallback = null;

  // ------------------------------------------------------------
  // OPEN
  // ------------------------------------------------------------
  function open(songId, onDone) {
    const song = Songs.getById(songId);
    if (!song) return;

    currentSongId = songId;
    onDoneCallback = onDone || null;

    const modal = document.getElementById('pasteChordsModal');
    if (!modal) {
      console.error('[PasteChords] Modal not found in DOM');
      return;
    }

    // Populate header
    document.getElementById('pasteChordsSongTitle').textContent = song.title;

    // Reset fields
    document.getElementById('pasteChordsTextarea').value = '';
    document.getElementById('pasteChordsPreview').style.display = 'none';
    document.getElementById('pasteChordsPreviewText').textContent = '';
    document.getElementById('pasteChordsWarning').style.display = 'none';
    document.getElementById('pasteChordsWarningText').textContent = '';
    document.getElementById('pasteChordsReplaceBtn').disabled = true;

    modal.classList.add('open');
    setTimeout(() => document.getElementById('pasteChordsTextarea').focus(), 60);
  }

  function close() {
    const modal = document.getElementById('pasteChordsModal');
    if (modal) modal.classList.remove('open');
    currentSongId = null;
    onDoneCallback = null;
  }

  // ------------------------------------------------------------
  // LIVE PREVIEW
  // ------------------------------------------------------------
  function updatePreview() {
    const raw = document.getElementById('pasteChordsTextarea').value;
    const preview = document.getElementById('pasteChordsPreview');
    const previewText = document.getElementById('pasteChordsPreviewText');
    const warning = document.getElementById('pasteChordsWarning');
    const warningText = document.getElementById('pasteChordsWarningText');
    const replaceBtn = document.getElementById('pasteChordsReplaceBtn');

    if (!raw.trim()) {
      preview.style.display = 'none';
      warning.style.display = 'none';
      replaceBtn.disabled = true;
      return;
    }

    // Quick counts
    const lines = raw.split('\n');
    let sectionCount = 0;
    let chordLineCount = 0;
    let firstLyricLine = '';

    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;

      if (PT.looksLikeChordLine && PT.looksLikeChordLine(t)) {
        chordLineCount++;
        continue;
      }

      // Section markers
      if (/^\[[^\]]+\]$/.test(t)) { sectionCount++; continue; }
      if (/^#+\s*.+/.test(t)) { sectionCount++; continue; }
      if (/^(verse|chorus|bridge|intro|outro|tag|pre-?chorus|instrumental|interlude)\b/i.test(t) && t.length < 40) {
        sectionCount++;
        continue;
      }

      // First real lyric line (not a chord line, not a section)
      if (!firstLyricLine && /[a-z]/i.test(t)) {
        firstLyricLine = t.slice(0, 60) + (t.length > 60 ? '…' : '');
      }
    }

    const wordCount = raw.trim().split(/\s+/).length;

    // Show preview
    preview.style.display = 'flex';
    previewText.textContent =
      `Detected: ${sectionCount} section${sectionCount === 1 ? '' : 's'} · ` +
      `${chordLineCount} chord line${chordLineCount === 1 ? '' : 's'} · ` +
      `${wordCount} words`;

    // Warnings
    const warnings = [];
    if (chordLineCount === 0) {
      warnings.push('No chord lines detected — the paste looks like lyrics only.');
    }
    if (wordCount < 5) {
      warnings.push('The paste is very short. Did you copy the full song?');
    }

    // Title mismatch detection — look for a title-like line at the top
    // that is different from the song's title.
    const currentSong = Songs.getById(currentSongId);
    if (currentSong) {
      const firstNonBlank = lines.find(l => l.trim().length > 0) || '';
      const candidate = firstNonBlank.trim().replace(/^#+\s*/, '');
      const norm = s => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      const normCurrent = norm(currentSong.title);
      const normCandidate = norm(candidate);

      // Only warn if the candidate looks like a title (short, has letters)
      if (
        candidate.length > 0 &&
        candidate.length < 60 &&
        /[a-z]/i.test(candidate) &&
        normCandidate !== normCurrent &&
        !PT.looksLikeChordLine(candidate) &&
        // And is at least 60% similar in structure — we don't want to warn on every chord progression
        // We just check it's not obviously a lyric continuation
        candidate.split(/\s+/).length <= 8
      ) {
        warnings.push(
          `The first line says "${candidate.slice(0, 40)}${candidate.length > 40 ? '…' : ''}" — ` +
          `make sure you're pasting the right song.`
        );
      }
    }

    if (warnings.length > 0) {
      warning.style.display = 'flex';
      warningText.textContent = warnings.join(' ');
      // Still allow replace — this is a heads-up, not a block
      replaceBtn.disabled = false;
    } else {
      warning.style.display = 'none';
      replaceBtn.disabled = false;
    }
  }

  // ------------------------------------------------------------
  // REPLACE
  // ------------------------------------------------------------
  function doReplace() {
    if (!currentSongId) return;

    const song = Songs.getById(currentSongId);
    if (!song) return;

    const raw = document.getElementById('pasteChordsTextarea').value.trim();
    if (!raw) {
      alert('Nothing to paste.');
      return;
    }

    // Parse to HTML
    let html = PT.plainTextToHtml(raw);

    // If no sections detected, wrap in a generic Verse 1
    if (!/class="section"/.test(html)) {
      html = `<div class="section">Verse 1</div>\n` + html;
    }

    // Infer the key from the new chords. If it differs from the
    // existing key, ask the user whether to update it.
    const inferredKey = MT.inferKeyFromHtml(html);
    let newKey = song.key;
    if (inferredKey && inferredKey !== song.key) {
      const keep = confirm(
        `The new chord sheet looks like it's in the key of ${inferredKey}.\n\n` +
        `OK = update the song's key to ${inferredKey}\n` +
        `Cancel = keep the current key (${song.key})`
      );
      if (keep) newKey = inferredKey;
    }

    // Update the song
    Songs.update(currentSongId, {
      chordSheet: html,
      key: newKey
    });

    close();

    if (onDoneCallback) onDoneCallback(song.id);

    console.log(`[PasteChords] Replaced chords for "${song.title}" (key: ${newKey})`);
  }

  // ------------------------------------------------------------
  // WIRE (called once from app.js)
  // ------------------------------------------------------------
  function wire() {
    const modal = document.getElementById('pasteChordsModal');
    if (!modal) return;

    // Textarea input → live preview
    const ta = document.getElementById('pasteChordsTextarea');
    if (ta) ta.addEventListener('input', updatePreview);

    // Replace button
    const btn = document.getElementById('pasteChordsReplaceBtn');
    if (btn) btn.addEventListener('click', doReplace);

    // Close buttons — wired via data-close elsewhere, but we also
    // need to reset state on close.
    document.querySelectorAll('#pasteChordsModal [data-close]').forEach(el => {
      el.addEventListener('click', close);
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
  }

  return {
    open,
    close,
    wire
  };
})();