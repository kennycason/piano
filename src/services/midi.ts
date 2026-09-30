import type { Midi } from '@tonejs/midi';
import {
  CURRENT_SONG_SCHEMA_VERSION,
  KEY_SIGNATURES,
  createId,
  getKeySignatureAccidental,
  getMeasureCapacity,
  type Accidental,
  type Dynamic,
  type NoteDuration,
  type NoteEntry,
  type Song,
  type StaffClef,
} from '../models/song';

export interface MidiImportResult {
  song: Song;
  warnings: string[];
  importedTrackCount: number;
}

interface QuantizedNote {
  midi: number;
  start: number;
  end: number;
  velocity: number;
}

interface QuantizedEvent {
  start: number;
  end: number;
  midi: number[];
  velocity: number;
}

interface ImportedVoice {
  clef: StaffClef;
  label: string;
  events: QuantizedEvent[];
}

const DURATION_UNITS: Array<{
  units: number;
  duration: NoteDuration;
  dotted?: boolean;
}> = [
  { units: 16, duration: 'w' },
  { units: 12, duration: 'h', dotted: true },
  { units: 8, duration: 'h' },
  { units: 6, duration: 'q', dotted: true },
  { units: 4, duration: 'q' },
  { units: 3, duration: '8', dotted: true },
  { units: 2, duration: '8' },
  { units: 1, duration: '16' },
];

const SHARP_PITCHES: Array<[string, Accidental | null]> = [
  ['c', null], ['c', '#'], ['d', null], ['d', '#'], ['e', null], ['f', null],
  ['f', '#'], ['g', null], ['g', '#'], ['a', null], ['a', '#'], ['b', null],
];
const FLAT_PITCHES: Array<[string, Accidental | null]> = [
  ['c', null], ['d', 'b'], ['d', null], ['e', 'b'], ['e', null], ['f', null],
  ['g', 'b'], ['g', null], ['a', 'b'], ['a', null], ['b', 'b'], ['b', null],
];
const MINOR_TO_RELATIVE_MAJOR: Record<string, string> = {
  A: 'C', E: 'G', B: 'D', 'F#': 'A', 'C#': 'E', 'G#': 'B', 'D#': 'F#', 'A#': 'C#',
  D: 'F', G: 'Bb', C: 'Eb', F: 'Ab', Bb: 'Db', Eb: 'Gb', Ab: 'Cb',
};

function isFlatKey(keySignature: string): boolean {
  return keySignature.includes('b') || keySignature === 'F';
}

function midiPitchToNotation(
  midi: number,
  keySignature: string,
): { key: string; accidental: Accidental | null } {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const [name, chromaticAccidental] = (isFlatKey(keySignature) ? FLAT_PITCHES : SHARP_PITCHES)[pitchClass];
  const signatureAccidental = getKeySignatureAccidental(keySignature, name);
  const accidental = chromaticAccidental ?? (signatureAccidental ? 'n' : null);
  return { key: `${name}/${octave}`, accidental };
}

function velocityToDynamic(velocity: number): Dynamic {
  if (velocity < 0.25) return 'pp';
  if (velocity < 0.4) return 'p';
  if (velocity < 0.55) return 'mp';
  if (velocity < 0.72) return 'mf';
  if (velocity < 0.88) return 'f';
  return 'ff';
}

function getSupportedKeySignature(key: string | undefined, isMinor = false): string {
  if (!key) return 'C';
  const normalized = key
    .replace(/ major$/i, '')
    .replace(/ minor$/i, '')
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#');
  const signature = isMinor ? MINOR_TO_RELATIVE_MAJOR[normalized] : normalized;
  return signature && (KEY_SIGNATURES as readonly string[]).includes(signature) ? signature : 'C';
}

function quantizeNotes(
  notes: Midi['tracks'][number]['notes'],
  gridTicks: number,
  clef: StaffClef,
): QuantizedNote[] {
  return notes.flatMap((note) => {
    const noteClef: StaffClef = note.midi >= 60 ? 'treble' : 'bass';
    if (noteClef !== clef) return [];
    const start = Math.max(0, Math.round(note.ticks / gridTicks));
    const rawEnd = Math.round((note.ticks + note.durationTicks) / gridTicks);
    return [{
      midi: note.midi,
      start,
      end: Math.max(start + 1, rawEnd),
      velocity: note.velocity,
    }];
  });
}

function groupChordEvents(notes: QuantizedNote[]): QuantizedEvent[] {
  const groups = new Map<string, QuantizedEvent>();
  notes.forEach((note) => {
    const key = `${note.start}:${note.end}`;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.midi.includes(note.midi)) existing.midi.push(note.midi);
      existing.velocity = Math.max(existing.velocity, note.velocity);
    } else {
      groups.set(key, {
        start: note.start,
        end: note.end,
        midi: [note.midi],
        velocity: note.velocity,
      });
    }
  });
  return [...groups.values()]
    .map((event) => ({ ...event, midi: event.midi.sort((a, b) => a - b) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function partitionEvents(events: QuantizedEvent[]): QuantizedEvent[][] {
  const lanes: QuantizedEvent[][] = [];
  events.forEach((event) => {
    const lane = lanes.find((candidate) => (
      candidate.length === 0 || candidate[candidate.length - 1].end <= event.start
    ));
    if (lane) lane.push(event);
    else lanes.push([event]);
  });
  return lanes;
}

function splitUnits(units: number): Array<{
  duration: NoteDuration;
  dotted?: boolean;
  units: number;
}> {
  const result: Array<{ duration: NoteDuration; dotted?: boolean; units: number }> = [];
  let remaining = units;
  while (remaining > 0) {
    const candidate = DURATION_UNITS.find((duration) => duration.units <= remaining)
      ?? DURATION_UNITS[DURATION_UNITS.length - 1];
    result.push(candidate);
    remaining -= candidate.units;
  }
  return result;
}

function createVoiceMeasures(
  events: QuantizedEvent[],
  clef: StaffClef,
  measureUnits: number,
  measureCount: number,
  keySignature: string,
  hideTimingRests: boolean,
): NoteEntry[][] {
  const measures = Array.from({ length: measureCount }, () => [] as NoteEntry[]);
  let cursor = 0;
  let hasDynamic = false;

  const appendSpan = (
    start: number,
    length: number,
    event?: QuantizedEvent,
  ) => {
    let spanCursor = start;
    let remaining = length;
    while (remaining > 0) {
      const measureIdx = Math.floor(spanCursor / measureUnits);
      const roomInMeasure = measureUnits - (spanCursor % measureUnits);
      const inMeasureUnits = Math.min(remaining, roomInMeasure);
      const parts = splitUnits(inMeasureUnits);
      parts.forEach((part, partIdx) => {
        const pitchData = event
          ? event.midi.map((midi) => midiPitchToNotation(midi, keySignature))
          : [];
        const isFinalEventPart = Boolean(event) && remaining === inMeasureUnits && (
          partIdx === parts.length - 1
        );
        const accidentals = pitchData.map((pitch) => pitch.accidental);
        const note: NoteEntry = {
          id: createId(),
          keys: event
            ? pitchData.map((pitch) => pitch.key)
            : [clef === 'treble' ? 'b/4' : 'd/3'],
          duration: part.duration,
          dotted: part.dotted,
          isRest: event ? undefined : true,
          isSpacer: !event && hideTimingRests ? true : undefined,
          accidentals: event && accidentals.some(Boolean) ? accidentals : undefined,
          tieToNext: event && !isFinalEventPart ? true : undefined,
          dynamic: event && !hasDynamic ? velocityToDynamic(event.velocity) : undefined,
        };
        measures[measureIdx]?.push(note);
        if (event) hasDynamic = true;
        spanCursor += part.units;
      });
      remaining -= inMeasureUnits;
    }
  };

  events.forEach((event) => {
    if (event.start > cursor) appendSpan(cursor, event.start - cursor);
    appendSpan(event.start, event.end - event.start, event);
    cursor = event.end;
  });
  return measures;
}

export function convertMidiToSong(midi: Midi, fallbackTitle = 'Imported MIDI'): MidiImportResult {
  const warnings = new Set<string>();
  const ppq = midi.header.ppq;
  if (!Number.isFinite(ppq) || ppq <= 0) throw new Error('The MIDI file has an invalid timing resolution.');

  const firstTimeSignature = midi.header.timeSignatures[0]?.timeSignature;
  const numerator = Math.max(1, Math.min(32, Math.round(firstTimeSignature?.[0] ?? 4)));
  const rawDenominator = Math.round(firstTimeSignature?.[1] ?? 4);
  const denominator = [1, 2, 4, 8, 16, 32].includes(rawDenominator) ? rawDenominator : 4;
  const timeSignature: [number, number] = [numerator, denominator];
  if (midi.header.timeSignatures.length > 1) {
    warnings.add('Time-signature changes are not supported yet; the first meter was used.');
  }
  if (rawDenominator !== denominator) {
    warnings.add(`The ${rawDenominator} denominator is unsupported; 4/4-compatible timing was used.`);
  }

  const firstKeyEvent = midi.header.keySignatures[0];
  const firstKey = firstKeyEvent?.key;
  const isMinor = firstKeyEvent?.scale?.toLowerCase().includes('minor') ?? false;
  const keySignature = getSupportedKeySignature(firstKey, isMinor);
  if (firstKey && keySignature === 'C' && getSupportedKeySignature(firstKey) !== firstKey && !isMinor) {
    warnings.add(`The key signature “${firstKey}” is unsupported; C major was used.`);
  }
  if (midi.header.keySignatures.length > 1) {
    warnings.add('Key-signature changes are not supported yet; the first key was used.');
  }
  if (isMinor) {
    warnings.add('The relative-major key signature was used; minor mode is preserved by the imported pitches.');
  }
  if (midi.header.tempos.length > 1) {
    warnings.add('Tempo changes are not supported yet; the first tempo was used.');
  }

  const gridTicks = ppq / 4;
  const measureUnits = Math.max(1, Math.round(getMeasureCapacity(timeSignature) * 4));
  const voices: ImportedVoice[] = [];
  let importedTrackCount = 0;

  midi.tracks.forEach((track, trackIdx) => {
    if (track.instrument.percussion) {
      if (track.notes.length > 0) warnings.add('Percussion tracks were skipped.');
      return;
    }
    if (track.notes.length === 0) return;
    importedTrackCount++;
    const baseLabel = track.name.trim() || track.instrument.name || `Track ${trackIdx + 1}`;
    for (const clef of ['treble', 'bass'] as const) {
      const notes = quantizeNotes(track.notes, gridTicks, clef);
      if (notes.length === 0) continue;
      const lanes = partitionEvents(groupChordEvents(notes));
      if (lanes.length > 1) {
        warnings.add('Overlapping notes were preserved as independent staff voices.');
      }
      lanes.forEach((events, laneIdx) => {
        voices.push({
          clef,
          label: lanes.length > 1 ? `${baseLabel} · voice ${laneIdx + 1}` : baseLabel,
          events,
        });
      });
    }
  });

  if (voices.length === 0) throw new Error('No pitched note tracks were found in this MIDI file.');
  warnings.add('Note starts and lengths were quantized to the nearest sixteenth note.');

  const maxEnd = Math.max(...voices.flatMap((voice) => voice.events.map((event) => event.end)));
  const measureCount = Math.max(1, Math.ceil(maxEnd / measureUnits));
  const staffVoiceCounts: Record<StaffClef, number> = { treble: 0, bass: 0 };
  const voiceMeasures = voices.map((voice) => {
    const staffVoiceIdx = staffVoiceCounts[voice.clef]++;
    return {
      ...voice,
      measures: createVoiceMeasures(
        voice.events,
        voice.clef,
        measureUnits,
        measureCount,
        keySignature,
        staffVoiceIdx > 0,
      ),
    };
  });
  const trebleVoices = voiceMeasures.filter((voice) => voice.clef === 'treble');
  const bassVoices = voiceMeasures.filter((voice) => voice.clef === 'bass');
  const measures = Array.from({ length: measureCount }, (_, measureIdx) => ({
    treble: trebleVoices[0]?.measures[measureIdx] ?? [],
    bass: bassVoices[0]?.measures[measureIdx] ?? [],
    additionalTrebleVoices: trebleVoices.length > 1
      ? trebleVoices.slice(1).map((voice) => voice.measures[measureIdx])
      : undefined,
    additionalBassVoices: bassVoices.length > 1
      ? bassVoices.slice(1).map((voice) => voice.measures[measureIdx])
      : undefined,
  }));
  const now = Date.now();
  const rawTempo = midi.header.tempos[0]?.bpm ?? 120;
  const tempo = Math.round(Math.max(20, Math.min(300, rawTempo)));
  if (rawTempo < 20 || rawTempo > 300) {
    warnings.add('Tempo was limited to the editor range of 20–300 BPM.');
  }
  const title = midi.name.trim() || fallbackTitle.trim() || 'Imported MIDI';
  const song: Song = {
    schemaVersion: CURRENT_SONG_SCHEMA_VERSION,
    id: createId(),
    title,
    tempo,
    timeSignature,
    keySignature,
    staffLayout: trebleVoices.length > 0 && bassVoices.length > 0
      ? 'grand'
      : trebleVoices.length > 0 ? 'treble-only' : 'bass-only',
    voiceLabels: {
      ...(trebleVoices.length > 0 ? { treble: trebleVoices.map((voice) => voice.label) } : {}),
      ...(bassVoices.length > 0 ? { bass: bassVoices.map((voice) => voice.label) } : {}),
    },
    measures,
    createdAt: now,
    updatedAt: now,
  };
  return { song, warnings: [...warnings], importedTrackCount };
}

export async function importSongFromMidi(file: File): Promise<MidiImportResult> {
  const { Midi } = await import('@tonejs/midi');
  const buffer = await file.arrayBuffer();
  let midi: Midi;
  try {
    midi = new Midi(buffer);
  } catch {
    throw new Error('This file could not be parsed as MIDI.');
  }
  const filename = file.name.replace(/\.(?:mid|midi)$/i, '');
  return convertMidiToSong(midi, filename);
}
