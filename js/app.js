// ============================================================
// app.js — full wiring
// ============================================================
//
// This is the main entry point. It:
//   1. Loads songs + setlists from storage
//   2. Seeds the library on first run
//   3. Renders the sidebar (songs + setlists)
//   4. Renders the chord sheet view
//   5. Wires all controls, modals, and event handlers
//   6. Handles keyboard shortcuts
//   7. Exposes a small public API for cross-module callbacks
//
// All the heavy lifting lives in the other modules. This file
// is purely wiring.
// ============================================================

window.App = (function () {
  'use strict';

  const Storage = window.Storage;
  const MT = window.MusicTheory;
  const PT = window.ParserText;
  const ParserPdf = window.ParserPdf;
  const Songs = window.Songs;
  const Render = window.Render;
  const PdfExport = window.PdfExport;
  const Setlists = window.Setlists;

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  let activeSongId = null;
  let currentView = 'song';   // 'song' | 'setlist'
  let semitoneShift = 0;
  let capoFret = 0;
  let displayMode = 'letters';
  let activeAddTab = 'single';

  // Batch import queue state
  let batchQueue = [];
  let batchParsedSongs = [];
  let groupedBatchSongs = [];

  // ------------------------------------------------------------
  // DOM SHORTCUT
  // ------------------------------------------------------------
  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function getActiveSong() {
    return Songs.getById(activeSongId) || Songs.getAll()[0] || null;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ------------------------------------------------------------
  // VIEW SWITCHING
  // ------------------------------------------------------------
  function showSongView(songId) {
    currentView = 'song';
    $('view-song').classList.add('active');
    $('view-setlist').classList.remove('active');

    // Sidebar tab
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    const songsTab = document.querySelector('.sidebar-tab[data-panel="songs"]');
    if (songsTab) songsTab.classList.add('active');
    $('panel-songs').classList.add('active');
    $('panel-setlists').classList.remove('active');

    if (songId) displaySong(songId);
    renderSongList($('searchInput').value);
    renderSetlistSidebar();
  }

  function showSetlist(setlistId) {
    currentView = 'setlist';
    Setlists.setActive(setlistId);
    $('view-song').classList.remove('active');
    $('view-setlist').classList.add('active');

    // Sidebar tab
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    const setlistsTab = document.querySelector('.sidebar-tab[data-panel="setlists"]');
    if (setlistsTab) setlistsTab.classList.add('active');
    $('panel-songs').classList.remove('active');
    $('panel-setlists').classList.add('active');

    renderSetlistSidebar();
    renderActiveSetlist();
  }

  function confirmDeleteSetlist(id) {
    const sl = Setlists.getById(id);
    if (!sl) return;
    if (!confirm(`Delete setlist "${sl.name}"? This cannot be undone.`)) return;
    Setlists.remove(id);
    renderSetlistSidebar();
    if (Setlists.getActiveId()) {
      showSetlist(Setlists.getActiveId());
    } else {
      showSongView(activeSongId || Songs.getAll()[0]?.id);
    }
  }

  // ------------------------------------------------------------
  // SIDEBAR: SONG LIST
  // ------------------------------------------------------------
  function renderSongList(filterText = '') {
    const container = $('songList');
    container.innerHTML = '';
    const term = filterText.trim().toLowerCase();
    const all = Songs.getAll();
    const filtered = all.filter(song => {
      if (!term) return true;
      return song.title.toLowerCase().includes(term) ||
             (song.artist || '').toLowerCase().includes(term);
    });

    if (filtered.length === 0) {
      const noRes = document.createElement('div');
      noRes.className = 'no-results';
      noRes.textContent = 'No songs found';
      container.appendChild(noRes);
      return;
    }

    filtered.forEach(song => {
      const isCustom = song.id.startsWith('custom-');
      const item = document.createElement('div');
      item.className = 'song-item' +
        (song.id === activeSongId && currentView === 'song' ? ' active' : '');
      item.dataset.id = song.id;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'song-title-text';
      titleSpan.textContent = song.title;

      const right = document.createElement('span');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '0.3rem';

      const artistSpan = document.createElement('span');
      artistSpan.className = 'artist';
      artistSpan.textContent = song.artist || '';
      right.appendChild(artistSpan);

      if (isCustom) {
        const del = document.createElement('button');
        del.className = 'item-action';
        del.innerHTML = '<i class="fas fa-trash"></i>';
        del.title = 'Delete this song';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteSong(song.id);
        });
        right.appendChild(del);
      }

            item.appendChild(titleSpan);
      item.appendChild(right);
      item.addEventListener('click', () => showSongView(song.id));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const items = [
          {
            icon: 'fa-paste',
            label: 'Paste Chords',
            action: () => {
              PasteChords.open(song.id, (songId) => {
                // After replacing, if this is the active song, re-render it
                if (songId === activeSongId) {
                  displaySong(songId, false);
                } else {
                  // Just refresh the sidebar to reflect any key changes
                  renderSongList($('searchInput').value);
                }
              });
            }
          },
          { divider: true },
          {
            icon: 'fa-trash',
            label: 'Delete Song',
            danger: true,
            action: () => deleteSong(song.id)
          }
        ];
        ContextMenu.show(e.clientX, e.clientY, items);
      });
      container.appendChild(item);

    });
  }

  function deleteSong(id) {
    const song = Songs.getById(id);
    if (!song) return;
    if (!confirm(`Delete "${song.title}"? This cannot be undone.`)) return;

    Songs.remove(id);

    // Remove from any setlists
    Setlists.getAll().forEach(sl => {
      sl.items = sl.items.filter(it => it.songId !== id);
    });
    Setlists.save();

    if (activeSongId === id) {
      const next = Songs.getAll()[0];
      if (next) displaySong(next.id);
      else {
        $('selectedSongTitle').textContent = '—';
        $('selectedArtist').textContent = '—';
        $('chordSheet').innerHTML = '';
      }
    }
    renderSongList($('searchInput').value);
    renderSetlistSidebar();
    if (currentView === 'setlist') renderActiveSetlist();
  }

  // ------------------------------------------------------------
  // SIDEBAR: SETLIST LIST
  // ------------------------------------------------------------
  function renderSetlistSidebar() {
    Setlists.renderSidebarList($('setlistList'), Setlists.getActiveId(), currentView);
  }

  // ------------------------------------------------------------
  // SONG VIEW: RENDER
  // ------------------------------------------------------------
  function populateKeySelect(song) {
    const sel = $('keySelect');
    sel.innerHTML = '';
    MT.KEY_OPTIONS.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      sel.appendChild(opt);
    });
    if (song.key && !MT.KEY_OPTIONS.includes(song.key)) {
      const opt = document.createElement('option');
      opt.value = song.key;
      opt.textContent = song.key;
      sel.appendChild(opt);
    }
  }

  function updateKeyUI(song) {
    const target = MT.computeTargetKey(song, semitoneShift);
    let matchName = target.name;
    if (!MT.KEY_OPTIONS.includes(matchName)) {
      const alt = target.preferFlats ? MT.SHARP_NAMES[target.pc] : MT.FLAT_NAMES[target.pc];
      if (MT.KEY_OPTIONS.includes(alt)) matchName = alt;
    }
    $('keySelect').value = matchName;

    const badge = $('shiftBadge');
    if (semitoneShift === 0) {
      badge.textContent = '+0 st';
      badge.className = 'shift-badge zero';
    } else {
      const sign = semitoneShift > 0 ? '+' : '−';
      badge.textContent = `${sign}${Math.abs(semitoneShift)} st`;
      badge.className = 'shift-badge ' + (semitoneShift > 0 ? 'up' : 'down');
    }
    $('resetKey').disabled = semitoneShift === 0;

    // Capo UI
    $('capoSelect').value = String(capoFret);
    const capoBanner = $('capoBanner');
    if (capoFret > 0) {
      const shapeKey = MT.computeCapoShapeKey(song, semitoneShift, capoFret);
      $('capoIndicator').style.display = 'inline';
      $('capoIndicatorFret').textContent = capoFret;
      capoBanner.classList.add('visible');
      const modeLabel = displayMode === 'nashville'
        ? `Numbers relative to ${shapeKey.name}`
        : `Play ${shapeKey.name} shapes`;
      $('capoBannerText').textContent =
        `Capo ${capoFret} · ${modeLabel} · sounds as ${target.name}`;
    } else {
      $('capoIndicator').style.display = 'none';
      capoBanner.classList.remove('visible');
    }
  }

  function displaySong(songId, resetTranspose = true) {
    const song = Songs.getById(songId);
    if (!song) return;
    activeSongId = songId;
    if (resetTranspose) semitoneShift = 0;

    $('selectedSongTitle').textContent = song.title;
    $('selectedArtist').textContent = song.artist || '—';

    populateKeySelect(song);
    Render.renderChordSheetInto(song, $('chordSheet'), {
      shift: semitoneShift, capo: capoFret, mode: displayMode
    });
    updateKeyUI(song);
    $('chordContent').scrollTop = 0;
    renderSongList($('searchInput').value);
  }

  // ------------------------------------------------------------
  // SETLIST VIEW: RENDER
  // ------------------------------------------------------------
  function renderActiveSetlist() {
    const sl = Setlists.getActive();
    if (!sl) {
      $('setlistTitle').textContent = '—';
      $('setlistCount').textContent = '0 songs';
      $('setlistSongs').innerHTML = '';
      return;
    }

    $('setlistTitle').textContent = sl.name;
    const count = sl.items.length;
    $('setlistCount').textContent = `${count} song${count === 1 ? '' : 's'}`;

    Setlists.renderDetail($('setlistSongs'), sl, {
      onViewSong: (songId) => showSongView(songId),
      onAddSongs: () => openPicker(),
      onChanged: () => {
        renderActiveSetlist();
        renderSetlistSidebar();
      }
    });
  }

  // ------------------------------------------------------------
  // SONG PICKER
  // ------------------------------------------------------------
  function openPicker() {
    const sl = Setlists.getActive();
    if (!sl) return;
    $('pickerModal').classList.add('open');
    $('pickerSearchInput').value = '';
    renderPickerList('');
    setTimeout(() => $('pickerSearchInput').focus(), 60);
  }

  function renderPickerList(filterText) {
    const container = $('pickerList');
    container.innerHTML = '';
    const term = filterText.trim().toLowerCase();
    const filtered = Songs.getAll().filter(song => {
      if (!term) return true;
      return song.title.toLowerCase().includes(term) ||
             (song.artist || '').toLowerCase().includes(term);
    });

    if (filtered.length === 0) {
      const noRes = document.createElement('div');
      noRes.className = 'no-results';
      noRes.textContent = 'No songs match your search';
      container.appendChild(noRes);
      return;
    }

    filtered.forEach(song => {
      const item = document.createElement('label');
      item.className = 'picker-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = song.id;

      const info = document.createElement('div');
      info.className = 'picker-item-info';

      const title = document.createElement('div');
      title.className = 'picker-item-title';
      title.textContent = song.title;

      const artist = document.createElement('div');
      artist.className = 'picker-item-artist';
      artist.textContent = song.artist || '';

      info.appendChild(title);
      info.appendChild(artist);

      item.appendChild(cb);
      item.appendChild(info);
      container.appendChild(item);
    });
  }

  // ------------------------------------------------------------
  // ADD SONG MODAL
  // ------------------------------------------------------------
  function openAddModal() {
    $('addModal').classList.add('open');
    $('songTitleInput').value = '';
    $('songArtistInput').value = '';
    $('songKeyInput').value = 'G';
    $('chordTextInput').value = '';
    $('bulkInput').value = '';
    setTimeout(() => $('songTitleInput').focus(), 60);
  }

  function saveSingleSong() {
    const title = $('songTitleInput').value.trim();
    if (!title) { alert('Please enter a song title.'); $('songTitleInput').focus(); return; }

    const rawText = $('chordTextInput').value.trim();
    const html = rawText
      ? PT.plainTextToHtml(rawText)
      : Songs.placeholderChordSheet($('songKeyInput').value);

    const inferredKey = MT.inferKeyFromHtml(html);
    const selectedKey = $('songKeyInput').value;
    if (inferredKey && inferredKey !== selectedKey) {
      const msg = `Heads up: the chords look like they're in ${inferredKey}, but you selected ${selectedKey}.\n\nUse ${inferredKey}?`;
      if (confirm(msg)) $('songKeyInput').value = inferredKey;
    }

    const existing = Songs.findByTitle(title);
    if (existing) {
      if (confirm(`A song named "${existing.title}" already exists. Replace its chord sheet?`)) {
        Songs.update(existing.id, {
          artist: $('songArtistInput').value.trim() || existing.artist,
          key: $('songKeyInput').value,
          chordSheet: html
        });
        $('addModal').classList.remove('open');
        displaySong(existing.id);
        renderSongList($('searchInput').value);
      }
      return;
    }

    const newSong = Songs.add({
      title,
      artist: $('songArtistInput').value,
      key: $('songKeyInput').value,
      chordSheetHtml: html
    });
    $('addModal').classList.remove('open');
    showSongView(newSong.id);
  }

  function saveBulkSongs() {
    const lines = $('bulkInput').value.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { alert('Please paste at least one song title.'); return; }
    const created = [];
    lines.forEach(line => {
      const parts = line.split('|').map(p => p.trim());
      const title = parts[0];
      if (!title) return;
      if (Songs.findByTitle(title)) return;
      const artist = parts[1] || 'Unknown';
      const key = parts[2] && MT.NOTE_TO_PC[parts[2]] !== undefined ? parts[2] : 'G';
      const song = Songs.add({ title, artist, key });
      created.push(song);
    });
    $('addModal').classList.remove('open');
    renderSongList($('searchInput').value);
    if (created.length > 0) showSongView(created[0].id);
  }

  // ------------------------------------------------------------
  // BATCH PDF IMPORT
  // ------------------------------------------------------------
  function openUploadModal() {
    $('uploadModal').classList.add('open');
    batchQueue = [];
    batchParsedSongs = [];
    groupedBatchSongs = [];
    $('batchQueue').classList.remove('visible');
    $('batchItems').innerHTML = '';
    $('parsedResults').style.display = 'none';
    $('parsedSongsList').innerHTML = '';
    $('parseError').classList.remove('visible');
    $('importParsed').disabled = true;
    $('fileInput').value = '';
  }

  async function collectPdfsFromFiles(files) {
    const result = [];
    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.pdf')) {
        result.push({ name: file.name, blob: file });
      } else if (lower.endsWith('.zip')) {
        try {
          const zip = await JSZip.loadAsync(file);
          const tasks = [];
          zip.forEach((path, entry) => {
            if (entry.dir) return;
            if (path.toLowerCase().endsWith('.pdf')) {
              tasks.push(
                entry.async('blob').then(blob => {
                  const baseName = path.split('/').pop() || path;
                  result.push({ name: baseName, blob });
                })
              );
            }
          });
          await Promise.all(tasks);
        } catch (err) {
          console.warn('Could not read ZIP:', file.name, err);
          throw new Error(`ZIP extraction failed: ${file.name}`);
        }
      }
    }
    // De-dupe by name
    const seen = new Set();
    return result.filter(f => {
      const key = f.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function walkEntries(entries, out) {
    const queue = [...entries];
    while (queue.length > 0) {
      const entry = queue.shift();
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        out.push(file);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const children = await new Promise((res, rej) => reader.readEntries(res, rej));
        queue.push(...children);
      }
    }
  }

  async function handleBatchFiles(files) {
    $('parseError').classList.remove('visible');
    $('parsedResults').style.display = 'none';
    $('importParsed').disabled = true;
    batchParsedSongs = [];

    const pdfsOrZips = files.filter(f => {
      const n = f.name.toLowerCase();
      return n.endsWith('.pdf') || n.endsWith('.zip');
    });

    if (pdfsOrZips.length === 0) {
      showParseError('No PDF or ZIP files were found in the selection.');
      return;
    }

    let pdfs = [];
    try {
      pdfs = await collectPdfsFromFiles(pdfsOrZips);
    } catch (err) {
      showParseError(err.message || String(err));
      return;
    }

    if (pdfs.length === 0) {
      showParseError('No PDF files were found.');
      return;
    }

    batchQueue = pdfs.map(p => ({
      name: p.name,
      size: p.blob.size,
      status: 'queued',
      error: null,
      songs: []
    }));

    renderBatchQueue();
    $('batchQueue').classList.add('visible');

    for (let i = 0; i < pdfs.length; i++) {
      batchQueue[i].status = 'parsing';
      renderBatchQueue();
      updateBatchSummary();
      await new Promise(r => setTimeout(r, 0));
      try {
        const parsed = await ParserPdf.parseFile(pdfs[i].blob);
        batchQueue[i].status = 'done';
        batchQueue[i].songs = parsed;
        batchParsedSongs.push(...parsed.map(s => ({ ...s, _source: pdfs[i].name })));
      } catch (err) {
        console.error('Failed to parse', pdfs[i].name, err);
        batchQueue[i].status = 'error';
        batchQueue[i].error = err.message || String(err);
      }
      renderBatchQueue();
      updateBatchSummary();
    }

    renderBatchResults();
  }

  function renderBatchQueue() {
    const container = $('batchItems');
    container.innerHTML = '';
    batchQueue.forEach(item => {
      const row = document.createElement('div');
      row.className = 'batch-item';

      const status = document.createElement('div');
      status.className = 'batch-status ' + item.status;
      if (item.status === 'queued') status.innerHTML = '<i class="fas fa-clock"></i>';
      else if (item.status === 'parsing') status.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      else if (item.status === 'done') status.innerHTML = '<i class="fas fa-check-circle"></i>';
      else if (item.status === 'error') status.innerHTML = '<i class="fas fa-exclamation-circle"></i>';

      const name = document.createElement('div');
      name.className = 'batch-name';
      name.textContent = item.name;

      const info = document.createElement('div');
      info.className = 'batch-info';
      if (item.status === 'queued') info.textContent = formatBytes(item.size);
      else if (item.status === 'parsing') info.textContent = 'Parsing…';
      else if (item.status === 'done') {
        const count = item.songs.length;
        info.textContent = count === 0 ? 'No songs found' : `${count} song${count === 1 ? '' : 's'}`;
        if (count > 0) info.classList.add('success-text');
      } else if (item.status === 'error') {
        info.textContent = item.error || 'Failed';
        info.classList.add('error-text');
      }

      row.appendChild(status);
      row.appendChild(name);
      row.appendChild(info);
      container.appendChild(row);
    });
  }

  function updateBatchSummary() {
    const total = batchQueue.length;
    const done = batchQueue.filter(b => b.status === 'done').length;
    const errors = batchQueue.filter(b => b.status === 'error').length;
    const totalSongs = batchParsedSongs.length;
    const parts = [`${done}/${total} processed`];
    if (errors > 0) parts.push(`${errors} failed`);
    parts.push(`${totalSongs} song${totalSongs === 1 ? '' : 's'}`);
    $('batchSummary').textContent = parts.join(' · ');
  }

  function renderBatchResults() {
    $('parsedCount').textContent = batchParsedSongs.length;
    const list = $('parsedSongsList');
    list.innerHTML = '';

    if (batchParsedSongs.length === 0) {
      showParseError('No songs were detected in any of the uploaded files.');
      $('importParsed').disabled = true;
      return;
    }

    // Group duplicates by normalized title
    const grouped = new Map();
    batchParsedSongs.forEach(song => {
      const norm = Songs.normalizeTitle(song.title);
      if (!grouped.has(norm)) {
        grouped.set(norm, { song, sources: [song._source] });
      } else {
        const existing = grouped.get(norm);
        if (song.chordSheet.length > existing.song.chordSheet.length) {
          existing.song = song;
        }
        existing.sources.push(song._source);
      }
    });

    groupedBatchSongs = Array.from(grouped.values()).map(g => g.song);

    let idx = 0;
    grouped.forEach(({ song, sources }) => {
      const existing = Songs.findByTitle(song.title);
      const willMerge = !!existing;

      const card = document.createElement('div');
      card.className = 'parsed-song-card';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.idx = String(idx);

      const info = document.createElement('div');
      info.className = 'parsed-song-info';

      const title = document.createElement('div');
      title.className = 'ps-title';
      title.innerHTML = MT.escapeHtml(song.title) +
        (willMerge ? ' <span class="ps-merge-tag">Will merge</span>' : '');

      const meta = document.createElement('div');
      meta.className = 'ps-meta';
      const sourceText = sources.length > 1 ? `${sources.length} files` : sources[0];
      meta.innerHTML = `
        <span><strong>Artist:</strong> ${MT.escapeHtml(song.artist)}</span>
        <span><strong>Key:</strong> ${MT.escapeHtml(song.key)}</span>
        <span class="ps-source-tag"><i class="fas fa-file-pdf" style="font-size:0.6rem;"></i> ${MT.escapeHtml(sourceText)}</span>
      `;

      const preview = document.createElement('div');
      preview.className = 'ps-preview';
      const plainPreview = song.chordSheet
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .trim()
        .slice(0, 100);
      preview.textContent = plainPreview + (plainPreview.length >= 100 ? '…' : '');

      info.appendChild(title);
      info.appendChild(meta);
      info.appendChild(preview);

      card.appendChild(cb);
      card.appendChild(info);
      list.appendChild(card);

      idx++;
    });

    $('parsedResults').style.display = 'block';
    $('importParsed').disabled = false;
    updateBatchSummary();
  }

  function importParsedSongs() {
    const checkboxes = $('parsedSongsList').querySelectorAll('input[type="checkbox"]:checked');
    if (checkboxes.length === 0) {
      alert('Please select at least one song to import.');
      return;
    }
    const imported = [];
    let addedCount = 0;
    let mergedCount = 0;

    checkboxes.forEach(cb => {
      const idx = parseInt(cb.dataset.idx, 10);
      const parsed = groupedBatchSongs[idx];
      if (!parsed) return;
      const plain = parsed.chordSheet.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!plain) return;

      const { song, merged } = Songs.mergeImported({
        title: parsed.title,
        artist: parsed.artist,
        key: parsed.key,
        chordSheetHtml: parsed.chordSheet
      });
      imported.push(song);
      if (merged) mergedCount++;
      else addedCount++;
    });

    $('uploadModal').classList.remove('open');
    renderSongList($('searchInput').value);
    if (imported.length > 0) showSongView(imported[0].id);
    console.log(`[Import] ${addedCount} added, ${mergedCount} merged`);
  }

  function showParseError(msg) {
    const el = $('parseError');
    el.textContent = msg;
    el.classList.add('visible');
  }

  // ------------------------------------------------------------
  // PDF EXPORT (single + setlist)
  // ------------------------------------------------------------
  async function downloadSingleSongPdf() {
    const song = getActiveSong();
    if (!song) return;
    if (!PdfExport.isReady()) { alert('The PDF library failed to load.'); return; }

    const btn = $('downloadPdf');
    const label = $('downloadLabel');
    const originalText = label.textContent;
    btn.classList.add('loading');
    label.textContent = 'Generating…';
    btn.disabled = true;

    try {
      await PdfExport.exportSong(song, {
        shift: semitoneShift,
        capo: capoFret,
        mode: displayMode
      });
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('Sorry, the PDF could not be generated.');
    } finally {
      btn.classList.remove('loading');
      label.textContent = originalText;
      btn.disabled = false;
    }
  }

  async function downloadSetlistPdf() {
    const sl = Setlists.getActive();
    if (!sl || sl.items.length === 0) { alert('This setlist has no songs to export.'); return; }
    if (!PdfExport.isReady()) { alert('The PDF library failed to load.'); return; }

    // Resolve items to songs
    const resolved = sl.items
      .map(item => ({ ...item, song: Songs.getById(item.songId) }))
      .filter(item => item.song);

    if (resolved.length === 0) { alert('No songs to export.'); return; }

    const btn = $('setlistDownloadBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…';
    btn.disabled = true;

    try {
      await PdfExport.exportSetlist(sl, resolved, { mode: displayMode });
    } catch (err) {
      console.error('Setlist PDF generation failed:', err);
      alert('Sorry, the setlist PDF could not be generated.');
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------
  // BACKUP / RESTORE
  // ------------------------------------------------------------
  function exportBackup() {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      songs: Songs.getAll(),
      setlists: Setlists.getAll()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `worship-charts-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const payload = JSON.parse(ev.target.result);
        if (!payload || typeof payload !== 'object') throw new Error('Invalid backup file');
        const incomingSongs = Array.isArray(payload.songs) ? payload.songs : [];
        const incomingSetlists = Array.isArray(payload.setlists) ? payload.setlists : [];

        const replaceDuplicates = confirm(
          `Backup contains ${incomingSongs.length} songs and ${incomingSetlists.length} setlists.\n\n` +
          `OK = MERGE (existing songs with matching titles will be replaced)\n` +
          `Cancel = IMPORT ONLY (add new songs, keep existing)`
        );

        const existingByTitle = new Map(
          Songs.getAll().map(s => [Songs.normalizeTitle(s.title), s])
        );
        let added = 0, replaced = 0;

        incomingSongs.forEach(incoming => {
          const norm = Songs.normalizeTitle(incoming.title);
          const existing = existingByTitle.get(norm);
          if (existing && replaceDuplicates) {
            Songs.update(existing.id, {
              artist: incoming.artist,
              key: incoming.key,
              chordSheet: incoming.chordSheet
            });
            replaced++;
          } else if (!existing) {
            Songs.add({
              title: incoming.title,
              artist: incoming.artist,
              key: incoming.key,
              chordSheetHtml: incoming.chordSheet
            });
            added++;
          }
        });

        const existingSetlistIds = new Set(Setlists.getAll().map(s => s.id));
        let setlistsAdded = 0;
        incomingSetlists.forEach(sl => {
          if (!existingSetlistIds.has(sl.id)) {
            Setlists.getAll().push(sl);
            setlistsAdded++;
          }
        });
        Setlists.save();

        renderSongList($('searchInput').value);
        renderSetlistSidebar();

        alert(
          `Import complete.\n` +
          `Songs added: ${added}\n` +
          `Songs ${replaceDuplicates ? 'replaced' : 'skipped'}: ${replaced || incomingSongs.length - added}\n` +
          `Setlists added: ${setlistsAdded}`
        );
      } catch (err) {
        console.error(err);
        alert('Could not read that backup file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------
  // MARK AS PLAYED
  // ------------------------------------------------------------
  function openMarkPlayedModal(setlist) {
    // Reset modal
    const todayIso = UsageLog.today();
    $('markPlayedDate').value = todayIso;
    $('markPlayedNotes').value = '';

    // Render the song list
    const container = $('markPlayedSongList');
    container.innerHTML = '';
    let validCount = 0;

    setlist.items.forEach(item => {
      const song = Songs.getById(item.songId);
      if (!song) return;
      validCount++;
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '0.5rem';
      row.style.padding = '0.25rem 0';
      row.innerHTML = `
        <i class="fas fa-music" style="color:#b8a695;font-size:0.75rem;"></i>
        <span style="flex:1;">${song.title}</span>
        <span style="color:#8a7767;font-size:0.78rem;">${song.artist || ''}</span>
      `;
      container.appendChild(row);
    });

    $('markPlayedCount').textContent = String(validCount);

    // Store a reference for the confirm handler
    window.__markPlayedSetlist = setlist;

    // Show modal
    $('markPlayedModal').classList.add('open');
  }

  // ------------------------------------------------------------
  // WIRE EVERYTHING
  // ------------------------------------------------------------
  function wireAll() {
    // ---- Sidebar tabs ----
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const panel = tab.dataset.panel;
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
        $('panel-' + panel).classList.add('active');
      });
    });

    // ---- Search ----
    $('searchInput').addEventListener('input', (e) => renderSongList(e.target.value));

    // ---- New setlist ----
    $('newSetlistInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const name = $('newSetlistInput').value.trim();
        if (!name) return;
        $('newSetlistInput').value = '';
        const sl = Setlists.create(name);
        showSetlist(sl.id);
      }
    });

    // ---- Modal close ----
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.close).classList.remove('open');
      });
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
      }
    });

    // ---- Add song modal ----
    $('openAddModal').addEventListener('click', openAddModal);
    document.querySelectorAll('#addModal .modal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#addModal .modal-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeAddTab = tab.dataset.tab;
        $('tab-single').classList.toggle('active', activeAddTab === 'single');
        $('tab-bulk').classList.toggle('active', activeAddTab === 'bulk');
        $('saveAdd').innerHTML = activeAddTab === 'single'
          ? '<i class="fas fa-check"></i> Add Song'
          : '<i class="fas fa-plus"></i> Add All';
      });
    });
    $('saveAdd').addEventListener('click', () => {
      if (activeAddTab === 'single') saveSingleSong();
      else saveBulkSongs();
    });

    // ---- Upload modal ----
    $('openUploadModal').addEventListener('click', openUploadModal);
    const dropzone = $('dropzone');
    dropzone.addEventListener('click', (e) => {
      if (e.target.closest('#browseFolderLink')) return;
      $('fileInput').click();
    });
    $('browseFolderLink').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      $('folderInput').click();
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const items = e.dataTransfer.items;
      const files = [];
      if (items && items.length > 0) {
        const entries = [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.kind === 'file') {
            const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
            if (entry) entries.push(entry);
            else files.push(it.getAsFile());
          }
        }
        if (entries.length > 0) await walkEntries(entries, files);
      } else if (e.dataTransfer.files) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          files.push(e.dataTransfer.files[i]);
        }
      }
      if (files.length > 0) handleBatchFiles(files);
    });
    $('fileInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) handleBatchFiles(files);
    });
    $('folderInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) handleBatchFiles(files);
    });
    $('importParsed').addEventListener('click', importParsedSongs);

    // ---- Song controls ----
    $('transposeUp').addEventListener('click', () => {
      semitoneShift += 1;
      if (semitoneShift > 11) semitoneShift = -11;
      const song = getActiveSong();
      if (song) {
        Render.renderChordSheetInto(song, $('chordSheet'), {
          shift: semitoneShift, capo: capoFret, mode: displayMode
        });
        updateKeyUI(song);
      }
    });
    $('transposeDown').addEventListener('click', () => {
      semitoneShift -= 1;
      if (semitoneShift < -11) semitoneShift = 11;
      const song = getActiveSong();
      if (song) {
        Render.renderChordSheetInto(song, $('chordSheet'), {
          shift: semitoneShift, capo: capoFret, mode: displayMode
        });
        updateKeyUI(song);
      }
    });
    $('resetKey').addEventListener('click', () => {
      semitoneShift = 0;
      const song = getActiveSong();
      if (song) {
        Render.renderChordSheetInto(song, $('chordSheet'), {
          shift: semitoneShift, capo: capoFret, mode: displayMode
        });
        updateKeyUI(song);
      }
    });
    $('keySelect').addEventListener('change', () => {
      const song = getActiveSong();
      if (!song) return;
      semitoneShift = MT.semitoneShiftBetween(song.key, $('keySelect').value);
      Render.renderChordSheetInto(song, $('chordSheet'), {
        shift: semitoneShift, capo: capoFret, mode: displayMode
      });
      updateKeyUI(song);
    });
    $('capoSelect').addEventListener('change', () => {
      capoFret = parseInt($('capoSelect').value, 10) || 0;
      const song = getActiveSong();
      if (song) {
        Render.renderChordSheetInto(song, $('chordSheet'), {
          shift: semitoneShift, capo: capoFret, mode: displayMode
        });
        updateKeyUI(song);
      }
    });
    $('toggleLetters').addEventListener('click', () => {
      if (displayMode === 'letters') return;
      displayMode = 'letters';
      $('toggleLetters').classList.add('active');
      $('toggleNashville').classList.remove('active');
      const song = getActiveSong();
      if (song) {
        Render.renderChordSheetInto(song, $('chordSheet'), {
          shift: semitoneShift, capo: capoFret, mode: displayMode
        });
        updateKeyUI(song);
      }
    });
    $('toggleNashville').addEventListener('click', () => {
      if (displayMode === 'nashville') return;
      displayMode = 'nashville';
      $('toggleNashville').classList.add('active');
      $('toggleLetters').classList.remove('active');
      const song = getActiveSong();
      if (song) {
        Render.renderChordSheetInto(song, $('chordSheet'), {
          shift: semitoneShift, capo: capoFret, mode: displayMode
        });
        updateKeyUI(song);
      }
    });
    $('downloadPdf').addEventListener('click', downloadSingleSongPdf);

    // ---- Setlist actions ----
    $('addSongsToSetlistBtn').addEventListener('click', openPicker);
    $('setlistDownloadBtn').addEventListener('click', downloadSetlistPdf);
    $('deleteSetlistBtn').addEventListener('click', () => {
      const sl = Setlists.getActive();
      if (sl) confirmDeleteSetlist(sl.id);
    });

    // ---- Picker modal ----
    $('pickerSearchInput').addEventListener('input', (e) => renderPickerList(e.target.value));
    $('pickerAddBtn').addEventListener('click', () => {
      const sl = Setlists.getActive();
      if (!sl) return;
      const checked = $('pickerList').querySelectorAll('input[type="checkbox"]:checked');
      if (checked.length === 0) return;
      const ids = Array.from(checked).map(cb => cb.value);
      Setlists.addSongs(sl.id, ids);
      $('pickerModal').classList.remove('open');
      renderActiveSetlist();
      renderSetlistSidebar();
    });

    // ---- Backup / restore ----
    $('exportLibraryBtn').addEventListener('click', exportBackup);
    $('importLibraryBtn').addEventListener('click', () => $('importLibraryInput').click());
    $('importLibraryInput').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importBackup(file);
      $('importLibraryInput').value = '';
    });

    // ---- Paste Chords modal ----
    if (window.PasteChords) {
      PasteChords.wire();
    }

    // ---- Usage tracking ----
    if (window.UsageLog) UsageLog.load();

    // Open the report modal from the sidebar
    $('openUsageReportBtn').addEventListener('click', () => {
      UsageReport.open();
    });

    // Mark setlist as played
    $('markPlayedBtn').addEventListener('click', () => {
      const sl = Setlists.getActive();
      if (!sl || sl.items.length === 0) {
        alert('This setlist has no songs to log.');
        return;
      }
      openMarkPlayedModal(sl);
    });

    // Wire the usage report modal
    if (window.UsageReport) UsageReport.wire();

    // TODO: IS THIS BLACK BEFORE "WIRE THE USAGE REPORT MODAL?" DOES IT MAKE A DIFFERENCE? If SO, move this blok before the //wire the usage report modal comment. If not, delete this comment and move on.
    // Confirm "Mark as Played"
    $('markPlayedConfirmBtn').addEventListener('click', () => {
      const sl = window.__markPlayedSetlist;
      if (!sl) return;

      const date = $('markPlayedDate').value || UsageLog.today();
      const notes = $('markPlayedNotes').value.trim();

      // Resolve song objects
      const songs = sl.items
        .map(item => Songs.getById(item.songId))
        .filter(Boolean);

      if (songs.length === 0) {
        alert('No valid songs to log.');
        return;
      }

      UsageLog.addEvent({
        date,
        setlistId: sl.id,
        setlistName: sl.name,
        notes,
        songs
      });

      // Reset and close
      window.__markPlayedSetlist = null;
      $('markPlayedModal').classList.remove('open');

      // Quick confirmation toast
      console.log(`[UsageLog] Logged ${songs.length} song${songs.length === 1 ? '' : 's'} for ${date}`);
    });
    ////////


    // ---- Keyboard shortcuts ----
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'SELECT') return;
      if (document.querySelector('.modal-overlay.open')) return;
      if (currentView !== 'song') return;

      if (e.key === '+' || e.key === '=') { e.preventDefault(); $('transposeUp').click(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); $('transposeDown').click(); }
      else if (e.key === '0') { e.preventDefault(); $('resetKey').click(); }
      else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (displayMode === 'nashville') $('toggleLetters').click();
        else $('toggleNashville').click();
      }
    });
  }

  // ------------------------------------------------------------
  // INIT
  // ------------------------------------------------------------
  function init() {
    // 1. Load songs and setlists from storage
    Songs.load();
    Setlists.load();
    if (window.UsageLog) UsageLog.load();

    // 2. Seed the library on first run
    Songs.seedIfNeeded();

    // 3. Wire all event handlers
    wireAll();

    // 4. Initial render
    renderSongList('');
    renderSetlistSidebar();

    // 5. Show the first song
    const all = Songs.getAll();
    if (all.length > 0) {
      displaySong(all[0].id);
    } else {
      $('selectedSongTitle').textContent = 'No songs yet';
      $('selectedArtist').textContent = 'Add a song or import a PDF to get started';
    }

    console.log('[Worship Charts] Ready.', {
      songs: all.length,
      setlists: Setlists.getAll().length
    });
  }

  // ------------------------------------------------------------
  // PUBLIC API (for cross-module callbacks)
  // ------------------------------------------------------------
  return {
    showSongView,
    showSetlist,
    confirmDeleteSetlist,
    init
  };
})();

// Boot
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  ready(() => window.App.init());
})();