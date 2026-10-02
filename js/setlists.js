// ============================================================
// setlists.js — setlist CRUD + drag & drop rendering
// ============================================================
//
// Exposes `Setlists`. Holds the in-memory setlist array, provides
// CRUD operations, and renders the setlist detail view (with
// drag-and-drop reordering and per-item overrides).
//
// The module owns the DOM inside #setlistSongs and the sidebar
// list at #setlistList. It delegates to `Songs` for lookups and
// to `Storage` for persistence.
// ============================================================

window.Setlists = (function () {
  'use strict';

  const Storage = window.Storage;
  const Songs = window.Songs;
  const MT = window.MusicTheory;

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  let setlists = [];
  let activeId = null;

  // ------------------------------------------------------------
  // UTILITIES
  // ------------------------------------------------------------
  function makeSetlistId() {
    return 'setlist-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 10000);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------
  // LIFECYCLE
  // ------------------------------------------------------------
  function load() {
    setlists = Storage.loadSetlists();
    return setlists;
  }

  function save() {
    Storage.saveSetlists(setlists);
  }

  // ------------------------------------------------------------
  // QUERY
  // ------------------------------------------------------------
  function getAll() {
    return setlists;
  }

  function getById(id) {
    return setlists.find(s => s.id === id) || null;
  }

  function getActive() {
    return getById(activeId);
  }

  function setActive(id) {
    activeId = id;
  }

  function getActiveId() {
    return activeId;
  }

  // ------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------
  function create(name) {
    const sl = {
      id: makeSetlistId(),
      name: (name || '').trim() || 'Untitled Setlist',
      createdAt: Date.now(),
      items: []
    };
    setlists.push(sl);
    save();
    return sl;
  }

  function remove(id) {
    const idx = setlists.findIndex(s => s.id === id);
    if (idx === -1) return false;
    setlists.splice(idx, 1);
    save();
    if (activeId === id) {
      activeId = setlists.length > 0 ? setlists[0].id : null;
    }
    return true;
  }

  function rename(id, newName) {
    const sl = getById(id);
    if (!sl) return null;
    sl.name = (newName || '').trim() || sl.name;
    save();
    return sl;
  }

  function addSong(setlistId, songId) {
    const sl = getById(setlistId);
    if (!sl) return null;
    sl.items.push({ songId, key: null, capo: 0, notes: '' });
    save();
    return sl.items[sl.items.length - 1];
  }

  function addSongs(setlistId, songIds) {
    const sl = getById(setlistId);
    if (!sl) return 0;
    let added = 0;
    songIds.forEach(id => {
      sl.items.push({ songId: id, key: null, capo: 0, notes: '' });
      added++;
    });
    save();
    return added;
  }

  function removeSongAt(setlistId, index) {
    const sl = getById(setlistId);
    if (!sl) return false;
    if (index < 0 || index >= sl.items.length) return false;
    sl.items.splice(index, 1);
    save();
    return true;
  }

  function moveSong(setlistId, fromIndex, toIndex) {
    const sl = getById(setlistId);
    if (!sl) return false;
    if (fromIndex < 0 || fromIndex >= sl.items.length) return false;
    if (toIndex < 0 || toIndex >= sl.items.length) return false;
    if (fromIndex === toIndex) return false;
    const [moved] = sl.items.splice(fromIndex, 1);
    sl.items.splice(toIndex, 0, moved);
    save();
    return true;
  }

  function updateItem(setlistId, index, patch) {
    const sl = getById(setlistId);
    if (!sl) return null;
    const item = sl.items[index];
    if (!item) return null;
    Object.assign(item, patch);
    save();
    return item;
  }

  // ------------------------------------------------------------
  // RENDERING — SIDEBAR LIST
  // ------------------------------------------------------------
  function renderSidebarList(containerEl, activeSetlistId, currentView) {
    containerEl.innerHTML = '';

    if (setlists.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty';
      empty.innerHTML = '<i class="fas fa-list-ol"></i>No setlists yet.<br>Type a name above and press Enter.';
      containerEl.appendChild(empty);
      return;
    }

    setlists.forEach(sl => {
      const item = document.createElement('div');
      item.className = 'setlist-item' +
        (sl.id === activeSetlistId && currentView === 'setlist' ? ' active' : '');
      item.dataset.id = sl.id;

      const info = document.createElement('div');
      info.className = 'setlist-item-info';

      const name = document.createElement('div');
      name.className = 'setlist-item-name';
      name.textContent = sl.name;

      const meta = document.createElement('div');
      meta.className = 'setlist-item-meta';
      const count = sl.items.length;
      meta.innerHTML = `<span>${count} song${count === 1 ? '' : 's'}</span>`;

      info.appendChild(name);
      info.appendChild(meta);

      const del = document.createElement('button');
      del.className = 'item-action';
      del.innerHTML = '<i class="fas fa-trash"></i>';
      del.title = 'Delete this setlist';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.App && window.App.confirmDeleteSetlist) {
          window.App.confirmDeleteSetlist(sl.id);
        }
      });

      item.appendChild(info);
      item.appendChild(del);
      item.addEventListener('click', () => {
        if (window.App && window.App.showSetlist) {
          window.App.showSetlist(sl.id);
        }
      });

      containerEl.appendChild(item);
    });
  }

  // ------------------------------------------------------------
  // RENDERING — DETAIL VIEW
  // ------------------------------------------------------------
  // Renders the active setlist into #setlistSongs. Each card has:
  //   - drag handle
  //   - position number
  //   - song title (click → view song)
  //   - artist
  //   - key override dropdown
  //   - capo override dropdown
  //   - remove button
  //   - notes input
  //
  // Calls back to App for song-view navigation and confirms.
  function renderDetail(containerEl, setlist, options) {
    const opts = options || {};
    const onViewSong = opts.onViewSong || (() => {});
    const onAddSongs = opts.onAddSongs || (() => {});
    const onChanged = opts.onChanged || (() => {});

    containerEl.innerHTML = '';

    if (!setlist || setlist.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'setlist-empty';
      empty.innerHTML = `
        <i class="fas fa-music"></i>
        <h3>No songs in this setlist yet</h3>
        <p>Add songs from your library, then drag them to reorder. Each song can have its own key, capo, and notes.</p>
        <button id="emptyAddSongs"><i class="fas fa-plus"></i> Add Songs</button>
      `;
      containerEl.appendChild(empty);
      const btn = empty.querySelector('#emptyAddSongs');
      if (btn) btn.addEventListener('click', onAddSongs);
      return;
    }

    setlist.items.forEach((item, index) => {
      const song = Songs.getById(item.songId);
      if (!song) return; // Song was deleted
      const card = buildSetlistCard(item, song, index, setlist, onViewSong, onChanged);
      containerEl.appendChild(card);
    });
  }

  function buildSetlistCard(item, song, index, setlist, onViewSong, onChanged) {
    // ----- Card container -----
    const card = document.createElement('div');
    card.className = 'setlist-song-card';
    card.draggable = true;
    card.dataset.index = index;

    // ----- Drag handle -----
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.innerHTML = '<i class="fas fa-grip-vertical"></i>';

    // ----- Position number -----
    const pos = document.createElement('div');
    pos.className = 'setlist-position';
    pos.textContent = String(index + 1);

    // ----- Info block -----
    const info = document.createElement('div');
    info.className = 'setlist-song-info';

    const title = document.createElement('div');
    title.className = 'setlist-song-title';
    title.textContent = song.title;
    title.title = 'Click to view full chord sheet';
    title.addEventListener('click', () => onViewSong(song.id));

    const meta = document.createElement('div');
    meta.className = 'setlist-song-meta';
    meta.innerHTML = `<span><i class="fas fa-user" style="font-size:0.6rem;"></i> ${escapeHtml(song.artist || '—')}</span>`;

    info.appendChild(title);
    info.appendChild(meta);

    // ----- Controls -----
    const controls = document.createElement('div');
    controls.className = 'setlist-song-controls';

    // Key override
    const keyWrap = document.createElement('div');
    keyWrap.className = 'mini-select-wrap';
    const keyLabel = document.createElement('label');
    keyLabel.textContent = 'Key';
    const keySel = document.createElement('select');
    MT.KEY_OPTIONS.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      keySel.appendChild(opt);
    });
    const effectiveKey = item.key || song.key || 'C';
    keySel.value = MT.KEY_OPTIONS.includes(effectiveKey) ? effectiveKey : 'C';
    keySel.addEventListener('change', () => {
      item.key = keySel.value;
      save();
      onChanged();
    });
    keyWrap.appendChild(keyLabel);
    keyWrap.appendChild(keySel);

    // Capo override
    const capoWrap = document.createElement('div');
    capoWrap.className = 'mini-select-wrap capo';
    const capoLabel = document.createElement('label');
    capoLabel.textContent = 'Capo';
    const capoSel = document.createElement('select');
    ['—','1','2','3','4','5','6','7'].forEach((c, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = c;
      capoSel.appendChild(opt);
    });
    capoSel.value = String(item.capo || 0);
    capoSel.addEventListener('change', () => {
      item.capo = parseInt(capoSel.value, 10) || 0;
      save();
      onChanged();
    });
    capoWrap.appendChild(capoLabel);
    capoWrap.appendChild(capoSel);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.title = 'Remove from setlist';
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.addEventListener('click', () => {
      setlist.items.splice(index, 1);
      save();
      onChanged();
    });

    controls.appendChild(keyWrap);
    controls.appendChild(capoWrap);
    controls.appendChild(removeBtn);

    // ----- Assemble card -----
    card.appendChild(handle);
    card.appendChild(pos);
    card.appendChild(info);
    card.appendChild(controls);

    // ----- Notes row (full width below card) -----
    const notes = document.createElement('input');
    notes.type = 'text';
    notes.className = 'setlist-notes-input';
    notes.placeholder = 'Notes for this song (intro, transitions, etc.)';
    notes.value = item.notes || '';
    notes.addEventListener('change', () => {
      item.notes = notes.value;
      save();
    });

    // ----- Wrapper -----
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '0';
    wrapper.appendChild(card);
    wrapper.appendChild(notes);

    // ----- Drag events -----
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.setlist-song-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (isNaN(fromIdx) || fromIdx === index) return;
      moveSong(setlist.id, fromIdx, index);
      onChanged();
    });

    return wrapper;
  }

  // ------------------------------------------------------------
  // PUBLIC API
  // ------------------------------------------------------------
  return {
    // Lifecycle
    load,
    save,

    // Query
    getAll,
    getById,
    getActive,
    getActiveId,
    setActive,

    // CRUD
    create,
    remove,
    rename,

    // Items
    addSong,
    addSongs,
    removeSongAt,
    moveSong,
    updateItem,

    // Rendering
    renderSidebarList,
    renderDetail,

    // Utilities
    makeSetlistId
  };
})();