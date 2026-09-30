# Piano Sheet roadmap

The editor now has a tested local-first core, versioned storage, responsive editing, and MIDI import. This roadmap separates the reliability work completed in the current pass from the remaining notation and practice features.

## Completed foundations

- Unit coverage for beat math, accidental inheritance, chord/cross-bar ties, repeats, storage migration and validation, checked-in song fixtures, and multi-track MIDI conversion
- GitHub Actions checks for lint, tests, and production builds
- Persisted schema versions with legacy migration, strict imports, storage-error feedback, and preservation of damaged entries during future saves
- In-app song deletion confirmation with one-click restore
- Automatic synthesized-audio fallback when the sampled grand piano is unavailable
- Responsive mobile layout, touch-sized controls, a horizontally scrollable 88-key keyboard, keyboard-accessible score menus, and visible save status
- Time-signature editing with overflow protection and same-staff voice creation
- Measure-scoped accidental notation, chord-aware ties, and ties/slurs across bars and wrapped systems
- Rendered pedal markings plus pedal and fermata playback behavior
- Sustained score/piano highlights, playback progress, and score-following cursor
- MIDI import with sixteenth-note quantization, chord detection, staff splitting, overlapping voice preservation, and import warnings
- First-class MIDI tracks with top-bar navigation, per-track notation/instrument metadata, mute/solo, ensemble playback, active-track highlighting, and editable percussion

## P0 — confidence and data safety

- Add browser interaction tests for composing, chord editing, undo/redo, switching songs, MIDI/JSON import, and playback state changes.
- Add export/restore for the complete local library, not just the active song.
- Offer an optional bundled piano or installable/PWA asset cache; synthesized sounds work offline, but sampled grand piano still needs its first network download.

## P1 — complete the notation workflow

- Extend the score insertion surface with a rhythmic caret and horizontal drag/reordering.
- Support note selection ranges, copy/paste, and multi-note edits.
- Add draggable slur endpoints and direct manipulation of pedal spans.
- Improve rhythmic engraving: automatic rests for unfilled beats, user-controlled beam groups, and tuplets.
- Add MIDI export and MusicXML import/export; JSON remains the lossless internal backup format.

## P2 — playback and practice

- Add play-from-selection and make the existing playback cursor seekable.
- Add metronome, count-in, loop-range controls, and per-hand mute/solo within a track.
- Make tempo changes during playback deterministic.
- Support repeat endings, D.C./D.S., coda, and more complete score navigation.
- Add detailed sampled-audio loading progress.

## P3 — product and architecture

- Split editor commands/history out of `App.tsx` into a reducer or command layer.
- Move rendering behind a small adapter so layout can be tested independently of the DOM.
- Reduce the initial VexFlow bundle (currently large enough to trigger Vite's chunk-size warning) through targeted imports, font handling, or deferred editor loading.
- Add song sorting/search, duplication, and explicit rename affordances.
- Decide whether the product stays local-first or adds accounts, sync, and collaboration.
- Add print/PDF layout, page sizing, and accessible high-contrast/light themes.

## Known limitations

- Playback supports straightforward start/end repeats, but not nested repeats or alternate endings.
- The key selector supports standard key signatures, but not custom/nonstandard accidental layouts.
- Empty portions of measures are visually blank rather than engraved with rests.
- Chords spanning both clefs are assigned to a single clef based on their lowest note.
- Pausing releases sustained notes; resuming continues at the paused score position rather than retriggering those held notes.
- MIDI import quantizes to sixteenth notes and uses the first tempo, meter, and key signature; later changes are reported but not imported.
- General MIDI program families and percussion are mapped to evolving synthesized approximations rather than exact hardware/sample-bank sounds.
