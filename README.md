# Worship Charts

A browser-based application for managing worship song chord charts, planning services, and generating printable materials for a worship team.

The application is a single-page web app built with plain HTML, CSS, and JavaScript. There is no build step, no framework, and no backend dependency. Song data, setlists, and usage history are stored in the browser's local storage.

---

## Features

### Song Library

- Seeded with 76 commonly used worship songs on first launch
- Supports manual entry, pasted text, and PDF-based import
- Handles chord extensions, slash chords, and alterations (e.g. `F#m7`, `Eb2(no3)`, `D/F#`, `Bbsus4`)
- Infers a song's key from the frequency of chord roots when no key is specified
- Export and restore the full library as a JSON backup

### PDF Import

Supports three common chord sheet formats:

- **SongSelect / CCLI** — preserves chord-over-lyric alignment using positional data; handles multi-column layouts and retains copyright footers
- **Psalmnote** — recognizes `# Verse 1` headers and `Key: C` metadata
- **Generic** — applies a permissive parser to most standard chord sheets

The importer supports batch processing of single PDFs, multiple PDFs, ZIP archives, or entire folders. When a parsed song matches a song already in the library, its chord sheet is updated rather than duplicated.

### Paste Chords

Individual songs can be edited directly by right-clicking the song in the sidebar and selecting **Paste Chords**. This opens a modal that accepts pasted text and replaces the song's existing chord sheet.

The parser recognizes and cleans up text from common web sources, including WorshipChords, Ultimate Guitar, and SongSelect Web. A live preview shows detected sections, chord lines, and word count before the change is committed.

### Musical Tools

- **Transposition** by semitone or direct key selection
- **Capo mode** — displays shapes relative to a capo position
- **Nashville Number System** — displays chords as scale degrees (`1`, `4`, `5`, `6m`) relative to the current key

These tools compose: transposition, capo position, and Nashville mode can be applied simultaneously.

### Setlists

- Create named setlists for services or rehearsals
- Reorder songs via drag and drop
- Override key, capo, and notes on a per-song basis
- Export the entire setlist as a single PDF, with each song rendered using its own settings

### Song Usage Tracking

- Mark a setlist as played to record it in the usage log
- Each event preserves a snapshot of the song titles and artists, ensuring historical records survive library changes
- Usage report with sortable table, date range filter, and search
- CSV export suitable for CCLI annual reporting

### Export

- **Single song PDF** — the current chord sheet rendered with the current transposition, capo, and Nashville settings
- **Setlist PDF** — all songs in a setlist, one per page, each using its own settings
- **Library backup** — full JSON export of the song library, setlists, and usage log
- **Usage CSV** — one row per song per service

---

## Getting Started

### Requirements

- A modern web browser (Chrome, Firefox, Safari, or Edge)
- No additional software is required to run the application

### Running Locally

Open `index.html` in a browser, or use a local development server to enable automatic reloading during development.

**Option 1 — Open the file directly**

Open `index.html` in your browser. The application will load and function normally.

**Option 2 — VS Code Live Server (recommended for development)**

1. Install [VS Code](https://code.visualstudio.com/) if necessary
2. Install the [Live Server extension](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer)
3. Right-click `index.html` and select **"Open with Live Server"**

Changes to any source file trigger an automatic browser reload.

**Option 3 — A local HTTP server**

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

### First Run

On first launch, the application seeds the song library with 76 songs. Two of those songs include sample chord content to demonstrate the display format. All data is stored in the browser's local storage and remains on the device unless the user explicitly exports it.

To reset the application to a fresh state:

```javascript
localStorage.clear()
location.reload()
```

---

## File Structure

```
worship-charts/
├── index.html              Application shell (structure only)
├── css/
│   └── styles.css          All styling
└── js/
    ├── storage.js          localStorage load and save
    ├── music-theory.js     Chord grammar, transposition, Nashville, key math
    ├── parser-text.js      Plain text to HTML conversion
    ├── parser-formats.js   Section header and metadata normalization
    ├── parser-pdf.js       Positional PDF text extraction
    ├── parser-web.js       Web source cleanup
    ├── songs.js            Song data model, CRUD, seed library
    ├── render.js           Chord sheet rendering
    ├── pdf-export.js       jsPDF export (single song and setlist)
    ├── setlists.js         Setlist data model and CRUD
    ├── usage-log.js        Usage event log and CSV export
    ├── usage-report.js     Usage report modal
    ├── context-menu.js     Right-click menu
    ├── paste-chords.js     Paste Chords modal
    └── app.js              Wiring and initialization
```

Scripts are loaded in dependency order at the end of `<body>`:

```
storage → music-theory → parser-text → parser-formats → parser-pdf → parser-web
→ songs → render → pdf-export → setlists → usage-log
→ context-menu → paste-chords → usage-report → app
```

Each module exposes a global namespace (`Storage`, `MusicTheory`, `Songs`, `Render`, and so on) that subsequent modules consume. There is no module bundler.

---

## Architecture

### Data Model

**Song**

```javascript
{
  id: 'custom-...',
  title: 'Goodness of God',
  artist: 'Bethel',
  key: 'A',
  chordSheet: '<div class="section">...</div>',
  custom: true,
  seeded: false
}
```

**Setlist**

```javascript
{
  id: 'setlist-...',
  name: 'Sunday AM',
  items: [
    {
      songId: 'custom-...',
      key: 'A',           // optional override; null uses the song's key
      capo: 0,            // optional override
      notes: 'Intro on keys only'
    }
  ]
}
```

**Usage Event**

```javascript
{
  id: 'usage-...',
  date: '2026-10-05',
  setlistId: 'setlist-...',
  setlistName: 'Sunday AM',
  notes: 'Reformation Sunday',
  songs: [
    { songId: 'custom-...', title: 'Goodness of God', artist: 'Bethel' }
  ],
  createdAt: 1234567890
}
```

### Rendering Pipeline

Chord sheets are stored as HTML with a `data-chord` attribute on every chord element. The attribute records the original letter chord in the song's original key and serves as the canonical source of truth for all subsequent transformations.

```html
<span class="pair">
  <span class="chord" data-chord="A">A</span>
  <span class="lyric">I&nbsp;love&nbsp;You,&nbsp;Lord</span>
</span>
```

The renderer reads from `data-chord` on every pass and applies transformations in order:

1. **Transpose** from the song's original key to the current sounding key
2. **Capo** — shift down by the capo fret to produce shape chords
3. **Nashville** — if enabled, convert to scale degrees relative to the shape key

Because the renderer always reads from `data-chord`, the operation is idempotent. Repeated rendering does not accumulate transformations.

### PDF Parsing

The PDF parser uses `pdf.js` to extract text fragments along with their X and Y coordinates, then reconstructs the page layout:

1. **Column detection** — a histogram of fragment X positions identifies single- or two-column layouts
2. **Line grouping** — fragments sharing a Y position are grouped into visual lines
3. **Classification** — each line is labeled as a section header, metadata, chord line, footer, or body text
4. **Chord alignment** — chord X ranges are used to slice the lyric line into syllables
5. **Song segmentation** — title-sized lines define song boundaries

### Storage

All persistent state is stored in the browser's `localStorage` under versioned keys:

| Key | Contents |
|---|---|
| `worship-charts-custom-songs-v2` | All songs (seeded, custom, and imported) |
| `worship-charts-setlists-v1` | All setlists |
| `worship-charts-usage-log-v1` | All usage events |
| `worship-charts-seeded-v1` | Flag indicating the initial seed has been applied |

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `+` or `=` | Transpose up one semitone |
| `-` or `_` | Transpose down one semitone |
| `0` | Reset to the original key |
| `N` | Toggle Nashville Number System |
| `Esc` | Close any open modal |

Shortcuts are disabled while a text input, textarea, or select element has focus.

---

## Debugging

Open the browser console and verify that each module has loaded:

```javascript
typeof Storage        // "object"
typeof MusicTheory    // "object"
typeof ParserText     // "object"
typeof ParserFormats  // "object"
typeof ParserPdf      // "object"
typeof ParserWeb      // "object"
typeof Songs          // "object"
typeof Render         // "object"
typeof PdfExport      // "object"
typeof Setlists       // "object"
typeof UsageLog       // "object"
typeof ContextMenu    // "object"
typeof PasteChords    // "object"
typeof UsageReport    // "object"
typeof App            // "object"
```

A result of `"undefined"` indicates that a module failed to load. The most common causes are an incorrect path in `index.html` or a syntax error within the file.

Inspect the loaded data:

```javascript
Songs.getAll()          // all songs
Setlists.getAll()       // all setlists
UsageLog.getAll()       // all usage events
```

Reset all local data:

```javascript
localStorage.clear()
location.reload()
```

---

## Development Notes

### Guiding Principles

- **Offline-first.** The application functions without a network connection. Any future backend integration should preserve this property.
- **Modular.** New features should be implemented as a new file with minimal additions to `app.js`, not as modifications spread across existing modules.
- **Tested in the browser.** There is no automated test suite. The application is small enough that manual verification through the browser console is sufficient for most changes.
- **Clear commit messages.** Describe intent rather than mechanism. For example: "Correct Nashville alignment in sharp keys" rather than "Update render.js".

---

## Roadmap

Features under consideration or planned:

- [ ] **Presenter Mode** — full-screen display for stage use, with optional auto-scroll
- [ ] **Supabase sync** — shared song library across devices and team members
- [ ] **CCLI number field** — attach CCLI song numbers for automatic inclusion in CSV exports
- [ ] **ChordPro importer** — support for SongSelect Premium downloads and community chord files
- [ ] **Chord diagrams** — inline guitar and piano fingering charts
- [ ] **Setlist duplication** — clone an existing setlist as a starting point
- [ ] **Song editing modal** — edit title, artist, and key in place
- [ ] **Print stylesheet** — `@media print` rules for cleaner paper output

---

## Credits

The application relies on the following third-party libraries:

- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF text extraction
- [jsPDF](https://github.com/parallax/jsPDF) — PDF generation
- [JSZip](https://stuk.github.io/jszip/) — ZIP archive handling
- [Font Awesome](https://fontawesome.com/) — iconography

All other logic, including chord parsing, music theory, rendering, and user interface, is original to this project.

---

## License

This is a personal project. It may be used freely for individual or congregational worship purposes. Attribution is appreciated but not required.