// ============================================================
// app.js — TEMPORARY STUB
// Message 1 of 4
//
// The full app wiring lands in Message 4. For now, this stub
// just shows a friendly placeholder so we can verify the
// layout, CSS, and script loading order all work.
// ============================================================

(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    console.log('[Worship Charts] Skeleton loaded. Waiting for modules...');

    // Show a friendly placeholder so we can see the layout working
    const songList = document.getElementById('songList');
    if (songList) {
      songList.innerHTML = `
        <div class="sidebar-empty">
          <i class="fas fa-hourglass-half"></i>
          Message 1 skeleton loaded.<br>
          Song modules arrive in the next message.
        </div>`;
    }

    const chordSheet = document.getElementById('chordSheet');
    if (chordSheet) {
      chordSheet.innerHTML = `
        <div style="padding:2rem;text-align:center;color:#a28c7a;">
          <h2 style="font-weight:500;margin-bottom:1rem;">Worship Charts</h2>
          <p style="line-height:1.6;">
            The layout is working. Next up:<br>
            <strong>Message 2</strong> — Core logic (music theory, storage, text parser)<br>
            <strong>Message 3</strong> — Heavy lifting (PDF parser, rendering, PDF export)<br>
            <strong>Message 4</strong> — Full wiring (setlists, all event handlers)
          </p>
        </div>`;
    }

    // Log which modules we expect to be loaded later
    const expectedModules = [
      'storage', 'music-theory', 'parser-text', 'parser-pdf',
      'songs', 'render', 'pdf-export', 'setlists', 'app'
    ];
    console.log('[Worship Charts] Modules to be loaded:', expectedModules.join(', '));
  });
})();