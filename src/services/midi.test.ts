import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { getMeasureVoices } from '../models/song';
import { convertMidiToSong } from './midi';

describe('MIDI conversion', () => {
  it('maps tracks to staves, preserves chords, gaps, and cross-bar ties', () => {
    const midi = new Midi();
    midi.name = 'Import Test';
    midi.header.setTempo(96);
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
    midi.header.keySignatures.push({ ticks: 0, key: 'G', scale: 'major' });
    const ppq = midi.header.ppq;
    midi.addTrack()
      .addNote({ midi: 64, ticks: 0, durationTicks: ppq, velocity: 0.7 })
      .addNote({ midi: 67, ticks: 0, durationTicks: ppq, velocity: 0.65 })
      .addNote({ midi: 66, ticks: ppq * 3, durationTicks: ppq * 2, velocity: 0.8 });
    midi.addTrack()
      .addNote({ midi: 48, ticks: 0, durationTicks: ppq * 2, velocity: 0.5 });

    const { song, importedTrackCount, warnings } = convertMidiToSong(midi, 'Fallback');

    expect(song.title).toBe('Import Test');
    expect(song.tempo).toBe(96);
    expect(song.keySignature).toBe('G');
    expect(song.tracks).toHaveLength(2);
    expect(song.tracks[0].staffLayout).toBe('treble-only');
    expect(song.tracks[0].measures).toHaveLength(2);
    expect(importedTrackCount).toBe(2);
    expect(warnings.some((warning) => warning.includes('sixteenth'))).toBe(true);

    const firstChord = song.tracks[0].measures[0].treble.find((note) => !note.isRest);
    expect(firstChord?.keys).toEqual(['e/4', 'g/4']);
    const finalFirstBarNote = song.tracks[0].measures[0].treble.at(-1);
    const firstSecondBarNote = song.tracks[0].measures[1].treble[0];
    expect(finalFirstBarNote?.keys).toEqual(['f/4']);
    expect(finalFirstBarNote?.accidentals).toEqual(['#']);
    expect(finalFirstBarNote?.tieToNext).toBe(true);
    expect(firstSecondBarNote.keys).toEqual(['f/4']);
    expect(firstSecondBarNote.tieToNext).toBeUndefined();
    expect(song.tracks[1].measures[0].bass.some((note) => !note.isRest)).toBe(true);
  });

  it('keeps overlapping notes with different lengths as independent voices', () => {
    const midi = new Midi();
    const ppq = midi.header.ppq;
    const track = midi.addTrack();
    track.name = 'Strings';
    track.addNote({ midi: 72, ticks: 0, durationTicks: ppq * 2 });
    track.addNote({ midi: 76, ticks: ppq, durationTicks: ppq * 2 });

    const { song, warnings } = convertMidiToSong(midi);

    expect(getMeasureVoices(song.tracks[0].measures[0], 'treble')).toHaveLength(2);
    expect(song.tracks[0].voiceLabels?.treble).toEqual(['Voice 1', 'Voice 2']);
    expect(song.tracks[0].measures[0].additionalTrebleVoices?.[0][0].isSpacer).toBe(true);
    expect(warnings.some((warning) => warning.includes('independent staff voices'))).toBe(true);
  });

  it('uses the relative-major key signature for minor MIDI metadata', () => {
    const midi = new Midi();
    midi.header.keySignatures.push({ ticks: 0, key: 'A', scale: 'minor' });
    midi.addTrack().addNote({ midi: 69, ticks: 0, durationTicks: midi.header.ppq });

    const { song, warnings } = convertMidiToSong(midi);

    expect(song.keySignature).toBe('C');
    expect(warnings.some((warning) => warning.includes('relative-major'))).toBe(true);
  });

  it('imports percussion as an editable drum track', () => {
    const midi = new Midi();
    const track = midi.addTrack();
    track.channel = 9;
    track.instrument.number = 0;
    track.name = 'Drums';
    track.addNote({ midi: 36, ticks: 0, durationTicks: 1 });
    track.addNote({ midi: 42, ticks: 0, durationTicks: 1 });

    const { song, importedTrackCount } = convertMidiToSong(midi);
    const drums = song.tracks[0];

    expect(importedTrackCount).toBe(1);
    expect(drums.kind).toBe('percussion');
    expect(drums.instrumentSound).toBe('drum-kit');
    expect(drums.staffClefs?.treble).toBe('percussion');
    expect(drums.measures[0].treble[0].drumMidi).toEqual([36, 42]);
  });
});
