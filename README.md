# Worship Charts

A single-page worship chord chart app for planning Sunday sets, transposing songs on the fly, and exporting printable PDFs for the team.

## Features

- **Song library** — seeded with 78 common worship songs, plus your own imports
- **Transpose** — shift keys with the semitone stepper or pick a target key directly
- **Capo mode** — for guitarists; shows shapes relative to a capo position
- **Nashville Number System** — toggle between letter chords and 1/4/5/6m
- **PDF import** — batch import chord sheets from PDFs (single files, ZIPs, or folders)
- **Setlists** — group songs into services, reorder with drag & drop, per-song overrides
- **PDF export** — download a single song or an entire setlist as a printable PDF
- **Backup / restore** — export everything as JSON and restore from a backup

## Development

No build step. Open `index.html` in a browser, or use VS Code's **Live Server** extension to auto-reload on save.

```bash
# Start a local server (optional)
python3 -m http.server 8000
# then visit http://localhost:8000