# Piano Sheet roadmap

The editor has a solid local-first prototype core. The next phase should prioritize confidence in the score model before broadening notation features.

## P0 — confidence and data safety

- Add unit tests for beat math, note insertion, transposition, repeat expansion, and import validation.
- Add browser interaction tests for composing, undo/redo, switching songs, and playback state changes.
- Introduce a persisted schema version and migrations before the `Song` model changes further.
- Replace blocking browser confirmation with an in-app confirmation/undo flow for song deletion.
- Add an offline or bundled audio strategy; playback currently needs network access on first use.

## P1 — complete the notation workflow

- Add a time-signature control with safe measure reflow rules.
- Extend the score insertion surface with a rhythmic caret and horizontal drag/reordering.
- Support note selection ranges, copy/paste, and multi-note edits.
- Render pedal markings and add draggable slur endpoints.
- Support ties and slurs across measure/system boundaries.
- Improve rhythmic engraving: rests for unfilled beats, beam grouping by meter, voice-creation controls, and tuplets.
- Add MusicXML and MIDI import/export; JSON should remain the lossless internal backup format.

## P2 — playback and practice

- Add play-from-selection and make the existing playback cursor seekable.
- Add metronome, count-in, loop-range controls, and per-hand mute/solo.
- Make tempo changes during playback deterministic.
- Support repeat endings, D.C./D.S., coda, and more complete score navigation.
- Add detailed audio loading progress and automatically fall back to a synthesized sound when samples are unavailable.

## P3 — product and architecture

- Split editor commands/history out of `App.tsx` into a reducer or command layer.
- Move rendering behind a small adapter so layout can be tested independently of the DOM.
- Reduce the initial VexFlow bundle (currently large enough to trigger Vite's chunk-size warning) through targeted imports, font handling, or deferred editor loading.
- Add autosave status, song sorting/search, duplication, and rename affordances.
- Decide whether the product stays local-first or adds accounts, sync, and collaboration.
- Add print/PDF layout, page sizing, and accessible high-contrast/light themes.

## Known limitations

- Playback supports straightforward start/end repeats, but not nested repeats or alternate endings.
- The key selector supports standard key signatures, but not custom/nonstandard accidental layouts.
- Empty portions of measures are visually blank rather than engraved with rests.
- Chords spanning both clefs are assigned to a single clef based on their lowest note.
- Additional same-staff voices can be imported and edited after selecting one of their notes, but there is not yet a UI command for creating a new voice from scratch.
- Pausing releases sustained notes; resuming continues at the paused score position rather than retriggering those held notes.
- The app currently has no automated tests or continuous integration.
