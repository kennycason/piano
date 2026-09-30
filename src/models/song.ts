export type NoteDuration = 'w' | 'h' | 'q' | '8' | '16';
export type Accidental = '#' | 'b' | 'n';
export type Dynamic = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff';
export type StaffClef = 'treble' | 'bass';
export type StaffLayout = 'grand' | 'treble-only' | 'bass-only';
export type SlurPlacement = 'above' | 'below';
export const KEY_SIGNATURES = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#',
  'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
] as const;
export type Articulation =
  | 'staccato'
  | 'fermata'
  | 'accent'
  | 'tenuto';

export interface NoteEntry {
  id: string;
  keys: string[];            // e.g. ["c/4", "e/4"] for chords
  duration: NoteDuration;
  isRest?: boolean;
  dotted?: boolean;
  /** Vertical rest adjustment in staff-line units; positive values move up. */
  restOffset?: number;
  accidentals?: (Accidental | null)[];  // per-key accidentals
  /** Keep an altered sounding pitch without reprinting its inherited accidental. */
  suppressAccidentals?: boolean;
  dynamic?: Dynamic;
  articulations?: Articulation[];
  tieToNext?: boolean;
  slurToNoteId?: string;
  slurPlacement?: SlurPlacement;
  /** Legacy endpoint flags retained for songs created before direct slur links. */
  slurStart?: boolean;
  slurEnd?: boolean;
  pedalStart?: boolean;
  pedalEnd?: boolean;
}

export interface Measure {
  treble: NoteEntry[];
  bass: NoteEntry[];
  /** Additional independent rhythmic voices rendered on the treble staff. */
  additionalTrebleVoices?: NoteEntry[][];
  /** Additional independent rhythmic voices rendered on the bass staff. */
  additionalBassVoices?: NoteEntry[][];
  repeatStart?: boolean;
  repeatEnd?: boolean;
}

export interface Song {
  id: string;
  title: string;
  tempo: number;
  timeSignature: [number, number];
  keySignature: string;       // e.g. "C", "G", "F", "Bb"
  /** Defaults to a traditional two-staff grand staff for older song files. */
  staffLayout?: StaffLayout;
  /** Override either displayed clef while retaining upper/lower staff storage. */
  staffClefs?: Partial<Record<StaffClef, StaffClef>>;
  /** Optional labels for each voice, ordered primary voice first. */
  voiceLabels?: Partial<Record<StaffClef, string[]>>;
  measures: Measure[];
  createdAt: number;
  updatedAt: number;
}

export function createId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function createDefaultNote(duration: NoteDuration = 'q', clef: StaffClef = 'treble'): NoteEntry {
  return {
    id: createId(),
    keys: [clef === 'treble' ? 'c/5' : 'c/3'],
    duration,
  };
}

export function createDefaultMeasure(): Measure {
  return {
    treble: [],
    bass: [],
  };
}

export function getMeasureVoices(measure: Measure, clef: StaffClef): NoteEntry[][] {
  const additional = clef === 'treble'
    ? measure.additionalTrebleVoices
    : measure.additionalBassVoices;
  return [measure[clef], ...(additional ?? [])];
}

export function getMeasureVoice(
  measure: Measure,
  clef: StaffClef,
  voiceIdx = 0,
): NoteEntry[] {
  return getMeasureVoices(measure, clef)[voiceIdx] ?? [];
}

export function replaceMeasureVoice(
  measure: Measure,
  clef: StaffClef,
  voiceIdx: number,
  notes: NoteEntry[],
): Measure {
  if (voiceIdx === 0) return { ...measure, [clef]: notes };

  if (clef === 'treble') {
    const voices = [...(measure.additionalTrebleVoices ?? [])];
    while (voices.length < voiceIdx) voices.push([]);
    voices[voiceIdx - 1] = notes;
    return { ...measure, additionalTrebleVoices: voices };
  }

  const voices = [...(measure.additionalBassVoices ?? [])];
  while (voices.length < voiceIdx) voices.push([]);
  voices[voiceIdx - 1] = notes;
  return { ...measure, additionalBassVoices: voices };
}

export function mapMeasureNotes(
  measure: Measure,
  mapper: (note: NoteEntry) => NoteEntry,
): Measure {
  return {
    ...measure,
    treble: measure.treble.map(mapper),
    bass: measure.bass.map(mapper),
    additionalTrebleVoices: measure.additionalTrebleVoices?.map((voice) => voice.map(mapper)),
    additionalBassVoices: measure.additionalBassVoices?.map((voice) => voice.map(mapper)),
  };
}

export function getMeasureNoteIds(measure: Measure): string[] {
  return (['treble', 'bass'] as const).flatMap((clef) => (
    getMeasureVoices(measure, clef).flatMap((voice) => voice.map((note) => note.id))
  ));
}

const DURATION_BEATS: Record<NoteDuration, number> = {
  w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25,
};

export function getNoteBeatValue(note: NoteEntry): number {
  let beats = DURATION_BEATS[note.duration] || 1;
  if (note.dotted) beats *= 1.5;
  return beats;
}

export function getMeasureBeatCount(notes: NoteEntry[]): number {
  return notes.reduce((sum, n) => sum + getNoteBeatValue(n), 0);
}

export function getMeasureCapacity(timeSignature: [number, number]): number {
  return timeSignature[0] * (4 / timeSignature[1]);
}

const KEY_SIGNATURE_ACCIDENTALS: Record<string, readonly string[]> = {
  G: ['f'],
  D: ['f', 'c'],
  A: ['f', 'c', 'g'],
  E: ['f', 'c', 'g', 'd'],
  B: ['f', 'c', 'g', 'd', 'a'],
  'F#': ['f', 'c', 'g', 'd', 'a', 'e'],
  'C#': ['f', 'c', 'g', 'd', 'a', 'e', 'b'],
  F: ['b'],
  Bb: ['b', 'e'],
  Eb: ['b', 'e', 'a'],
  Ab: ['b', 'e', 'a', 'd'],
  Db: ['b', 'e', 'a', 'd', 'g'],
  Gb: ['b', 'e', 'a', 'd', 'g', 'c'],
  Cb: ['b', 'e', 'a', 'd', 'g', 'c', 'f'],
};

export function getKeySignatureAccidental(
  keySignature: string,
  pitchName: string,
): Accidental | null {
  const pitches = KEY_SIGNATURE_ACCIDENTALS[keySignature];
  if (!pitches?.includes(pitchName[0]?.toLowerCase())) return null;
  return keySignature.includes('b') || keySignature === 'F' ? 'b' : '#';
}

export function createDefaultSong(): Song {
  return {
    id: createId(),
    title: 'Untitled',
    tempo: 120,
    timeSignature: [4, 4],
    keySignature: 'C',
    measures: [createDefaultMeasure(), createDefaultMeasure(), createDefaultMeasure(), createDefaultMeasure()],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
