// ============================================================
// songs.js — song data, CRUD, seed library
// ============================================================
//
// Exposes `Songs` with the in-memory library, CRUD operations,
// and the seeding logic for the 78-song starter list.
// ============================================================

window.Songs = (function () {
  'use strict';

  const Storage = window.Storage;
  const MT = window.MusicTheory;

  // ------------------------------------------------------------
  // SEED LIST — all 78 songs from the master list
  // ------------------------------------------------------------
  const SEED_SONGS = [
    ["All Glory Be to Christ", "King's Kaleidoscope"],
    ["All Hail King Jesus", "Bethel"],
    ["Alpha and Omega", "Israel Houghton"],
    ["Already Loved", "Tim Timmons"],
    ["At Your Name (Yahweh Yahweh)", "Phil Wickham"],
    ["Awesome God", "Michael W. Smith"],
    ["Be Unto Your Name", "Travis Cottrell"],
    ["Before the Throne of God Above", "Shane & Shane"],
    ["Behold Him", "Integrity Music"],
    ["Behold Our God", "Sovereign Grace Music"],
    ["Blessed Be Your Name", "Matt Redman"],
    ["Build My Life", "Housefires"],
    ["Come Thou Fount (Above All Else)", "Shane & Shane"],
    ["Cornerstone", "Hillsong"],
    ["Do It Again", "Elevation"],
    ["Forever Reign", "Hillsong"],
    ["Glorious Day", "Passion/Kristian Stanfill"],
    ["Good Good Father", "Chris Tomlin"],
    ["Goodness of God", "Bethel"],
    ["Graves into Gardens", "Brandon Lake"],
    ["Great Are You Lord", "All Sons & Daughters"],
    ["Great I Am", "New Life Worship"],
    ["Great is Thy Faithfulness", "Hymn"],
    ["Heart of Worship", "Matt Redman"],
    ["Here I Am to Worship", "Chris Tomlin"],
    ["Highest Praise", "Phil Wickham & Matt Redman"],
    ["Holy Forever", "Chris Tomlin"],
    ["Holy Holy Holy (We Bow Before Thee)", "Shane & Shane"],
    ["Holy Spirit", "Kari Jobe ft. Cody Carnes"],
    ["I Give Myself Away", "William McDowell"],
    ["I Speak Jesus", "Charity Gayle"],
    ["I Want to Know You", "CityAlight"],
    ["I Will Follow", "Chris Tomlin"],
    ["I Will Wait for You", "Shane & Shane"],
    ["In Christ Alone", "CityAlight"],
    ["It Really Is Amazing Grace", "Phil Wickham ft. David Crowder"],
    ["Jehovah Is Your Name", "Ntokozo Mbambo"],
    ["Jesus at the Center", "Israel Houghton"],
    ["King of Kings", "Hillsong"],
    ["King of My Heart", "Bethel"],
    ["Living Hope", "Phil Wickham"],
    ["Lord I Need You", "Matt Maher"],
    ["Man of Sorrows", "Hillsong"],
    ["Mighty to Save", "Hillsong"],
    ["My Redeemer Lives", "Hillsong"],
    ["My Worship", "Phil Thompson"],
    ["Nothing But the Blood", "Hymn"],
    ["O Praise the Name", "Hillsong"],
    ["Only a Holy God", "CityAlight"],
    ["Open The Eyes Of My Heart", "Michael W. Smith"],
    ["Our God", "Chris Tomlin"],
    ["Praise", "Elevation"],
    ["Promises", "Maverick City Music"],
    ["Psalm 23 (I Am Not Alone)", "People & Songs"],
    ["Psalm 42 (I Will Praise Him Again)", "CityAlight"],
    ["Revelation Song", "Kari Jobe"],
    ["Same God", "Elevation"],
    ["Shout to the Lord", "Hillsong"],
    ["Sing for Joy", "Don Moen"],
    ["Sufficient for Today", "Maverick City Music"],
    ["Thank You, Lord", "Don Moen"],
    ["The Blessing", "Elevation & Kari Jobe"],
    ["The Lord Is My Salvation", "Shane & Shane"],
    ["This Is Amazing Grace", "Phil Wickham"],
    ["Tis So Sweet to Trust in Jesus", "Century Worship"],
    ["Way Maker", "Leeland"],
    ["What A Beautiful Name", "Hillsong"],
    ["Who Else", "Abbie Gamboa"],
    ["Wonderful Merciful Savior", "Selah"],
    ["Worthy", "Elevation"],
    ["Worthy of It All", "CeCe Winans"],
    ["Yahweh", "Hillsong"],
    ["Yet Not I But Through Christ in Me", "CityAlight"],
    ["You Are God Alone", "Phillips, Craig, and Dean/William McDowell"],
    ["You Are Good", "Israel Houghton"],
    ["You've Already Won", "Shane & Shane"]
  ];

  // ------------------------------------------------------------
  // SAMPLE CHORDS — pre-filled for two songs so the app isn't
  // completely empty on first load.
  // ------------------------------------------------------------
  const SAMPLE_CHORDS = {
    "goodness of god": {
      key: "A",
      html: `
<div class="section">Verse 1</div>
<div class="line">
  <span class="pair"><span class="chord" data-chord="A">A</span><span class="lyric">I&nbsp;love&nbsp;You,&nbsp;Lord,</span></span>
  <span class="pair"><span class="chord" data-chord="E">E</span><span class="lyric">for&nbsp;Your&nbsp;mercy</span></span>
  <span class="pair"><span class="chord" data-chord="F#m">F#m</span><span class="lyric">never&nbsp;fails&nbsp;me</span></span>
</div>
<div class="line">
  <span class="pair"><span class="chord" data-chord="A">A</span><span class="lyric">All&nbsp;my&nbsp;days,</span></span>
  <span class="pair"><span class="chord" data-chord="E">E</span><span class="lyric">I've&nbsp;been&nbsp;held</span></span>
  <span class="pair"><span class="chord" data-chord="D">D</span><span class="lyric">in&nbsp;Your&nbsp;hands</span></span>
</div>
<div class="section">Chorus</div>
<div class="line">
  <span class="pair"><span class="chord" data-chord="A">A</span><span class="lyric">All&nbsp;my&nbsp;life</span></span>
  <span class="pair"><span class="chord" data-chord="E">E</span><span class="lyric">You&nbsp;have&nbsp;been&nbsp;faithful</span></span>
</div>
<div class="line">
  <span class="pair"><span class="chord" data-chord="F#m">F#m</span><span class="lyric">All&nbsp;my&nbsp;life</span></span>
  <span class="pair"><span class="chord" data-chord="D">D</span><span class="lyric">You&nbsp;have&nbsp;been&nbsp;so,&nbsp;so&nbsp;good</span></span>
</div>
`
    },
    "way maker": {
      key: "E",
      html: `
<div class="section">Verse</div>
<div class="line">
  <span class="pair"><span class="chord" data-chord="E">E</span><span class="lyric">You&nbsp;are&nbsp;here,</span></span>
  <span class="pair"><span class="chord" data-chord="B">B</span><span class="lyric">moving&nbsp;in&nbsp;our&nbsp;midst</span></span>
</div>
<div class="line">
  <span class="pair"><span class="chord" data-chord="C#m">C#m</span><span class="lyric">I&nbsp;worship&nbsp;You,</span></span>
  <span class="pair"><span class="chord" data-chord="A">A</span><span class="lyric">I&nbsp;worship&nbsp;You</span></span>
</div>
<div class="section">Chorus</div>
<div class="line">
  <span class="pair"><span class="chord" data-chord="E">E</span><span class="lyric">Way&nbsp;maker,&nbsp;miracle&nbsp;worker</span></span>
</div>
<div class="line">
  <span class="pair"><span class="chord" data-chord="B">B</span><span class="lyric">Promise&nbsp;keeper,&nbsp;light&nbsp;in&nbsp;the&nbsp;darkness</span></span>
</div>
`
    }
  };

  // ------------------------------------------------------------
  // IN-MEMORY STATE
  // ------------------------------------------------------------
  let customSongs = [];   // persisted in localStorage
  let allSongs = [];      // alias for customSongs (kept for API clarity)

  // ------------------------------------------------------------
  // UTILITIES
  // ------------------------------------------------------------
  function normalizeTitle(t) {
    return String(t).toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function makeId(title) {
    const base = String(title).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'song';
    return 'custom-' + base + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 10000);
  }

  function placeholderChordSheet(key) {
    return `
<div class="section">Verse 1</div>
<div class="line">
  <span class="pair"><span class="chord" data-chord="${MT.escapeHtml(key)}">${MT.escapeHtml(key)}</span><span class="lyric">Edit&nbsp;this&nbsp;song&nbsp;to&nbsp;add&nbsp;the&nbsp;lyrics&nbsp;and&nbsp;chords…</span></span>
</div>`;
  }

  // ------------------------------------------------------------
  // SEEDING
  // ------------------------------------------------------------
  function seedIfNeeded() {
    if (Storage.hasSeeded()) return false;
    const existing = new Set(customSongs.map(s => normalizeTitle(s.title)));
    SEED_SONGS.forEach(([title, artist]) => {
      const norm = normalizeTitle(title);
      if (existing.has(norm)) return;
      const sample = SAMPLE_CHORDS[norm];
      customSongs.push({
        id: makeId(title),
        title,
        artist,
        key: sample ? sample.key : 'C',
        chordSheet: sample ? sample.html : placeholderChordSheet('C'),
        custom: true,
        seeded: true
      });
    });
    save();
    Storage.markSeeded();
    console.log(`[Songs] Seeded library with ${customSongs.length} songs.`);
    return true;
  }

  // ------------------------------------------------------------
  // PERSISTENCE
  // ------------------------------------------------------------
  function load() {
    customSongs = Storage.loadSongs();
    allSongs = customSongs;
    return customSongs;
  }

  function save() {
    Storage.saveSongs(customSongs);
  }

  // ------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------
  function getAll() {
    return customSongs;
  }

  function getById(id) {
    return customSongs.find(s => s.id === id) || null;
  }

  function findByTitle(title) {
    const norm = normalizeTitle(title);
    return customSongs.find(s => normalizeTitle(s.title) === norm) || null;
  }

  function add({ title, artist, key, chordSheetHtml, seeded }) {
    const song = {
      id: makeId(title),
      title: String(title).trim(),
      artist: (artist || '').trim() || 'Unknown',
      key: key || 'C',
      chordSheet: chordSheetHtml || placeholderChordSheet(key || 'C'),
      custom: true,
      seeded: !!seeded
    };
    customSongs.push(song);
    save();
    return song;
  }

  function update(id, patch) {
    const song = getById(id);
    if (!song) return null;
    Object.assign(song, patch);
    save();
    return song;
  }

  function remove(id) {
    const idx = customSongs.findIndex(s => s.id === id);
    if (idx === -1) return false;
    customSongs.splice(idx, 1);
    save();
    return true;
  }

  // ------------------------------------------------------------
  // IMPORT MERGE
  // ------------------------------------------------------------
  // Merge an imported song into the library. If a song with the
  // same normalized title exists, its chord sheet is replaced and
  // its key updated. Otherwise, a new song is added.
  //
  // Returns { song, merged: boolean }
  function mergeImported({ title, artist, key, chordSheetHtml }) {
    const existing = findByTitle(title);
    if (existing) {
      existing.chordSheet = chordSheetHtml;
      existing.key = key || existing.key;
      // Only overwrite artist if the existing one is a placeholder
      if (!existing.artist || existing.artist === 'Unknown') {
        existing.artist = artist || existing.artist;
      }
      existing.mergedAt = Date.now();
      save();
      return { song: existing, merged: true };
    }
    const song = add({ title, artist, key, chordSheetHtml });
    return { song, merged: false };
  }

  // ------------------------------------------------------------
  // PUBLIC API
  // ------------------------------------------------------------
  return {
    // Data
    SEED_SONGS,
    SAMPLE_CHORDS,

    // Lifecycle
    load,
    save,
    seedIfNeeded,

    // Query
    getAll,
    getById,
    findByTitle,

    // Mutate
    add,
    update,
    remove,
    mergeImported,

    // Utilities
    normalizeTitle,
    makeId,
    placeholderChordSheet
  };
})();