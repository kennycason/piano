# Song fixtures

These scores can be imported from the song-library sidebar. Importing a JSON file creates a new browser-local project; the checked-in file remains an unchanged reference fixture. Five fixtures—Alouette, The Marines’ Hymn, Orbiting Ruins, Pixel Parade, and the shared-bass-staff Teacher Duet—are also installed automatically as editable starter projects on the app's first run.

## Practice library

- `pixel-parade.json` — original upbeat platformer-style study with eighth-note motion, chords, articulation, slurs, and pedal.
- `pixel-parade-first-steps.json` — slower quarter-note version with single-note left-hand roots.
- `orbiting-ruins.json` — original atmospheric sci-fi prelude with sustained harmony, arpeggios, slurs, and pedal changes.
- `orbiting-ruins-first-steps.json` — reduced version with mostly half and whole notes.
- `midnight-mouse.json` — original early-elementary spooky study using rests, staccato thirds, short slurs, and repeat signs.
- `alouette-beginner.json` — beginner two-hand arrangement of the traditional public-domain French-Canadian melody.
- `marines-hymn-beginner.json` — beginner two-hand arrangement of the public-domain Marines’ Hymn, transposed to C major.

`Pixel Parade`, `Orbiting Ruins`, and `Midnight Mouse` are original fixtures. They provide the requested game-like and spooky learning moods without reproducing the melodies of copyrighted compositions. `Alouette` follows a CC0/public-domain melody source, and `The Marines’ Hymn` is based on its public-domain melody.

## Teacher duet fixtures

- `teacher-duet-single-bass-staff.json` follows the photographed engraving: both hands are independent voices on one bass staff, with R.H. stems up and L.H. stems down.
- `teacher-duet-split-hands.json` preserves the sounding pitches and separates the hands onto two bass-clef staves for easier reading.

The source excerpt does not show a title or tempo, so the fixture uses the descriptive title “Teacher Duet” and an editorial tempo of 88 BPM. The transcription is from the supplied photo and is intentionally kept as JSON so individual pitches can be corrected easily if a clearer source becomes available.

The shared-staff fixture also exercises the optional song fields `staffLayout`, `staffClefs`, `voiceLabels`, `additionalBassVoices`, and explicit `slurPlacement` values.
