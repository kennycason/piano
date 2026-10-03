import { describe, expect, it } from 'vitest';
import {
  createDefaultMeasure,
  getMeasureAccidentalDisplay,
  getMeasureBeatCount,
  getMeasureCapacity,
  getNoteMidiPitches,
  getTieIndexes,
  measurePianoKeys,
  notationPitchToPianoKey,
  notesHaveSamePitches,
  type NoteEntry,
} from './song';

function note(id: string, key: string, accidental?: '#' | 'b' | 'n'): NoteEntry {
  return {
    id,
    keys: [key],
    duration: 'q',
    accidentals: accidental ? [accidental] : undefined,
  };
}

describe('measure piano keys', () => {
  it('lists every sounding key in the bar using keyboard spelling', () => {
    const measure = createDefaultMeasure();
    measure.bass = [{
      id: 'lh',
      keys: ['f/2', 'bb/2', 'd/3'],
      duration: 'w',
    }];
    measure.treble = [
      note('rh-1', 'd/4'),
      note('rh-2', 'b/3', 'n'),
    ];
    expect(measurePianoKeys(measure, 'Bb').sort()).toEqual([
      'a#/2', 'b/3', 'd/3', 'd/4', 'f/2',
    ]);
  });
});

describe('score timing', () => {
  it('counts dotted durations against the selected meter', () => {
    expect(getMeasureBeatCount([
      { ...note('a', 'c/4'), duration: 'h', dotted: true },
      note('b', 'd/4'),
    ])).toBe(4);
    expect(getMeasureCapacity([6, 8])).toBe(3);
  });
});

describe('accidental engraving', () => {
  it('prints an accidental once, then prints a natural when the pitch changes back', () => {
    const measure = createDefaultMeasure();
    measure.treble = [
      note('sharp-1', 'c/4', '#'),
      note('sharp-2', 'c/4', '#'),
      note('natural-1', 'c/4'),
      note('natural-2', 'c/4'),
    ];

    const display = getMeasureAccidentalDisplay(measure, 'treble', 'C');
    expect(display.get('sharp-1')).toEqual(['#']);
    expect(display.get('sharp-2')).toEqual([null]);
    expect(display.get('natural-1')).toEqual(['n']);
    expect(display.get('natural-2')).toEqual([null]);
  });

  it('restores a key-signature accidental after an explicit natural', () => {
    const measure = createDefaultMeasure();
    measure.treble = [
      note('natural-f', 'f/4', 'n'),
      note('natural-f-again', 'f/4', 'n'),
      note('signature-f', 'f/4'),
    ];

    const display = getMeasureAccidentalDisplay(measure, 'treble', 'G');
    expect(display.get('natural-f')).toEqual(['n']);
    expect(display.get('natural-f-again')).toEqual([null]);
    expect(display.get('signature-f')).toEqual(['#']);
  });
});

describe('pitch and tie matching', () => {
  it('maps enharmonic staff spellings to their physical piano keys', () => {
    expect(notationPitchToPianoKey('e/3', '#')).toBe('f/3');
    expect(notationPitchToPianoKey('b/3', '#')).toBe('c/4');
    expect(notationPitchToPianoKey('c/4', 'b')).toBe('b/3');
    expect(notationPitchToPianoKey('f/4', 'b')).toBe('e/4');
    expect(notationPitchToPianoKey('f/4', undefined, 'G')).toBe('f#/4');
    expect(notationPitchToPianoKey('f/4', 'n', 'G')).toBe('f/4');
  });

  it('matches enharmonic chord tones and returns every tied notehead index', () => {
    const first: NoteEntry = {
      id: 'first', keys: ['c/4', 'e/4', 'g/4'], duration: 'q', accidentals: ['#', null, null],
    };
    const second: NoteEntry = {
      id: 'second', keys: ['d/4', 'e/4', 'g/4'], duration: 'q', accidentals: ['b', null, null],
    };

    expect(getNoteMidiPitches(first, 'C')).toEqual([61, 64, 67]);
    expect(notesHaveSamePitches(first, second, 'C')).toBe(true);
    expect(getTieIndexes(first, second, 'C')).toEqual({
      firstIndexes: [0, 1, 2],
      lastIndexes: [0, 1, 2],
    });
  });

  it('rejects ties to a different chord', () => {
    const first: NoteEntry = { id: 'first', keys: ['c/4', 'e/4'], duration: 'q' };
    const second: NoteEntry = { id: 'second', keys: ['c/4', 'f/4'], duration: 'q' };
    expect(notesHaveSamePitches(first, second, 'C')).toBe(false);
  });
});
