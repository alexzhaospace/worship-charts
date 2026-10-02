// ============================================================
// usage-report.js — the usage report modal
// ============================================================
//
// Exposes `UsageReport.open()` which shows a modal with:
//   - date range filter
//   - search
//   - aggregated table (title / artist / times used / last used)
//   - CSV export
//   - event log with delete
// ============================================================

window.UsageReport = (function () {
  'use strict';

  const UsageLog = window.UsageLog;

  let activeTab = 'stats';    // 'stats' | 'events'
  let sortColumn = 'timesUsed';
  let sortDirection = 'desc';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function $(id) { return document.getElementById(id); }

  // ------------------------------------------------------------
  // OPEN / CLOSE
  // ------------------------------------------------------------
  function open() {
    const modal = $('usageReportModal');
    if (!modal) {
      console.error('[UsageReport] Modal not found');
      return;
    }

    // Reset UI
    $('usageFromDate').value = '';
    $('usageToDate').value = '';
    $('usageSearch').value = '';
    activeTab = 'stats';
    sortColumn = 'timesUsed';
    sortDirection = 'desc';

    setTab('stats');
    renderStats();
    renderEvents();

    modal.classList.add('open');
  }

  function close() {
    const modal = $('usageReportModal');
    if (modal) modal.classList.remove('open');
  }

  // ------------------------------------------------------------
  // TABS
  // ------------------------------------------------------------
  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll('#usageReportModal .modal-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.usageTab === tab);
    });
    document.querySelectorAll('.usage-tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'usage-panel-' + tab);
    });
  }

  // ------------------------------------------------------------
  // STATS RENDERING
  // ------------------------------------------------------------
  function renderStats() {
    const from = $('usageFromDate').value;
    const to = $('usageToDate').value;
    const search = $('usageSearch').value.trim().toLowerCase();

    let stats = UsageLog.getStatsInRange(from, to);

    // Filter by search
    if (search) {
      stats = stats.filter(s =>
        (s.title || '').toLowerCase().includes(search) ||
        (s.artist || '').toLowerCase().includes(search)
      );
    }

    // Sort
    stats.sort((a, b) => {
      let va, vb;
      switch (sortColumn) {
        case 'title':     va = (a.title || '').toLowerCase(); vb = (b.title || '').toLowerCase(); break;
        case 'artist':    va = (a.artist || '').toLowerCase(); vb = (b.artist || '').toLowerCase(); break;
        case 'lastUsed':  va = a.lastUsed || ''; vb = b.lastUsed || ''; break;
        case 'timesUsed':
        default:          va = a.timesUsed; vb = b.timesUsed; break;
      }
      if (va < vb) return sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    const tbody = $('usageStatsBody');
    tbody.innerHTML = '';

    if (stats.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="4" style="text-align:center;padding:2rem;color:#a28c7a;font-style:italic;">No usage recorded yet. Mark a setlist as played to start tracking.</td>`;
      tbody.appendChild(row);
      return;
    }

    stats.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(s.title)}</td>
        <td style="color:#8a7767;font-size:0.85em;">${escapeHtml(s.artist)}</td>
        <td style="text-align:center;font-weight:600;color:#2c5b7a;">${s.timesUsed}</td>
        <td style="color:#8a7767;font-size:0.85em;">${escapeHtml(s.lastUsed)}</td>
      `;
      tbody.appendChild(tr);
    });

    // Update the count summary
    const total = stats.reduce((n, s) => n + s.timesUsed, 0);
    $('usageSummary').textContent = `${stats.length} song${stats.length === 1 ? '' : 's'} · ${total} usage${total === 1 ? '' : 's'}`;

    // Update sort indicators
    document.querySelectorAll('#usageStatsTable th').forEach(th => {
      const col = th.dataset.sortCol;
      th.classList.remove('sort-asc', 'sort-desc');
      if (col === sortColumn) th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    });
  }

  // ------------------------------------------------------------
  // EVENTS RENDERING
  // ------------------------------------------------------------
  function renderEvents() {
    const container = $('usageEventsList');
    container.innerHTML = '';

    const events = UsageLog.getAll().slice().sort((a, b) => b.date.localeCompare(a.date));

    if (events.length === 0) {
      container.innerHTML = `<div style="padding:2rem;text-align:center;color:#a28c7a;font-style:italic;">No events yet.</div>`;
      return;
    }

    events.forEach(ev => {
      const card = document.createElement('div');
      card.className = 'usage-event-card';

      const songList = ev.songs.map(s => escapeHtml(s.title)).join(' · ');

      card.innerHTML = `
        <div class="usage-event-date">${escapeHtml(ev.date)}</div>
        <div class="usage-event-info">
          <div class="usage-event-title">
            ${ev.setlistName ? escapeHtml(ev.setlistName) : 'Ad-hoc event'}
            <span class="usage-event-count">${ev.songs.length} song${ev.songs.length === 1 ? '' : 's'}</span>
          </div>
          <div class="usage-event-songs">${songList || '<em>no songs</em>'}</div>
          ${ev.notes ? `<div class="usage-event-notes">${escapeHtml(ev.notes)}</div>` : ''}
        </div>
        <button class="usage-event-delete" title="Delete this event">
          <i class="fas fa-trash"></i>
        </button>
      `;

      const delBtn = card.querySelector('.usage-event-delete');
      delBtn.addEventListener('click', () => {
        if (!confirm(`Delete the usage record for ${ev.date}?`)) return;
        UsageLog.removeEvent(ev.id);
        renderEvents();
        renderStats();
      });

      container.appendChild(card);
    });
  }

  // ------------------------------------------------------------
  // CSV EXPORT
  // ------------------------------------------------------------
  function exportCSV() {
    const from = $('usageFromDate').value;
    const to = $('usageToDate').value;

    // Build a filter based on the current date range
    const filterFn = (ev) => {
      if (from && ev.date < from) return false;
      if (to && ev.date > to) return false;
      return true;
    };

    const csv = UsageLog.toCSV(filterFn);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Filename reflects the range
    let rangePart = 'all-time';
    if (from && to) rangePart = `${from}_to_${to}`;
    else if (from) rangePart = `from_${from}`;
    else if (to) rangePart = `through_${to}`;

    a.download = `worship-charts-usage-${rangePart}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ------------------------------------------------------------
  // WIRE (called once from app.js)
  // ------------------------------------------------------------
  function wire() {
    const modal = $('usageReportModal');
    if (!modal) return;

    // Close buttons
    document.querySelectorAll('#usageReportModal [data-close]').forEach(el => {
      el.addEventListener('click', close);
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    // Tabs
    document.querySelectorAll('#usageReportModal .modal-tab').forEach(tab => {
      tab.addEventListener('click', () => setTab(tab.dataset.usageTab));
    });

    // Date filters
    $('usageFromDate').addEventListener('change', renderStats);
    $('usageToDate').addEventListener('change', renderStats);

    // Search
    $('usageSearch').addEventListener('input', renderStats);

    // Quick range buttons
    document.querySelectorAll('#usageReportModal [data-range]').forEach(btn => {
      btn.addEventListener('click', () => {
        const range = btn.dataset.range;
        const today = new Date();
        let from = '', to = '';

        if (range === 'year') {
          from = `${today.getFullYear()}-01-01`;
          to = `${today.getFullYear()}-12-31`;
        } else if (range === '12m') {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 1);
          from = UsageLog.isoDate(d);
          to = UsageLog.isoDate(new Date());
        } else if (range === 'clear') {
          from = '';
          to = '';
        }

        $('usageFromDate').value = from;
        $('usageToDate').value = to;
        renderStats();
      });
    });

    // Sortable headers
    document.querySelectorAll('#usageStatsTable th[data-sort-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sortCol;
        if (sortColumn === col) {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          sortColumn = col;
          sortDirection = col === 'timesUsed' ? 'desc' : 'asc';
        }
        renderStats();
      });
    });

    // CSV export
    $('usageExportCsvBtn').addEventListener('click', exportCSV);
  }

  return {
    open,
    close,
    wire,
    render: () => { renderStats(); renderEvents(); }
  };
})();