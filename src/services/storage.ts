import {
  CURRENT_SONG_SCHEMA_VERSION,
  DEFAULT_TRACK_SYNTH_CONTROLS,
  KEY_SIGNATURES,
  getMeasureBeatCount,
  getMeasureCapacity,
  getMeasureVoices,
  type Measure,
  type Song,
  type SongTrack,
} from '../models/song';
import alouetteBeginner from '../../songs/alouette-beginner.json';
import marinesHymnBeginner from '../../songs/marines-hymn-beginner.json';
import marinesHymn from '../../songs/marines-hymn.json';
import orbitingRuins from '../../songs/orbiting-ruins.json';
import pixelParade from '../../songs/pixel-parade.json';
import teacherDuetSingleBassStaff from '../../songs/teacher-duet-single-bass-staff.json';
import moonlightSonata from '../../songs/moonlight-sonata.json';
import lowerNorfair from '../../songs/lower-norfair.json';
import tuFaltaDeQuerer from '../../songs/tu-falta-de-querer.json';

const STORAGE_KEY = 'piano_sheet_songs';
const CURRENT_SONG_KEY = 'piano_sheet_current';
const SAMPLE_LIBRARY_VERSION_KEY = 'piano_sheet_sample_library_version';
const SAMPLE_LIBRARY_VERSION = '5';
export const DEFAULT_STARTER_SONG_ID = 'fixture-alouette-beginner';
const NOTE_DURATIONS = new Set(['w', 'h', 'q', '8', '16']);
const ACCIDENTALS = new Set(['#', 'b', 'n']);
const DYNAMICS = new Set(['pp', 'p', 'mp', 'mf', 'f', 'ff']);
const ARTICULATIONS = new Set(['staccato', 'fermata', 'accent', 'tenuto']);
const TIME_SIGNATURE_DENOMINATORS = new Set([1, 2, 4, 8, 16, 32]);
const KEY_SIGNATURE_SET = new Set<string>(KEY_SIGNATURES);
const INSTRUMENT_SOUNDS = new Set([
  'grand-piano', 'electric-keys', 'warm-pad', 'music-box',
  'string-ensemble', 'choir-aahs', 'synth-lead', 'synth-brass',
  'guitar', 'bass', 'organ', 'drum-kit',
]);
const BUNDLED_SAMPLE_CANDIDATES: unknown[] = [
  tuFaltaDeQuerer,
  lowerNorfair,
  moonlightSonata,
  alouetteBeginner,
  marinesHymnBeginner,
  marinesHymn,
  orbitingRuins,
  pixelParade,
  teacherDuetSingleBassStaff,
];

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isNoteEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const note = value as {
    id?: unknown;
    keys?: unknown;
    duration?: unknown;
    isRest?: unknown;
    isSpacer?: unknown;
    dotted?: unknown;
    accidentals?: unknown;
    suppressAccidentals?: unknown;
    dynamic?: unknown;
    articulations?: unknown;
    tieToNext?: unknown;
    slurToNoteId?: unknown;
    slurPlacement?: unknown;
    slurStart?: unknown;
    slurEnd?: unknown;
    pedalStart?: unknown;
    pedalEnd?: unknown;
    restOffset?: unknown;
    drumMidi?: unknown;
    fingers?: unknown;
  };
  return (
    typeof note.id === 'string' && note.id.length > 0 && note.id.length <= 200 &&
    Array.isArray(note.keys) &&
    note.keys.length > 0 && note.keys.length <= 32 &&
    note.keys.every((key) => typeof key === 'string' && /^[a-g](?:#|b)?\/-?\d{1,2}$/.test(key)) &&
    typeof note.duration === 'string' &&
    NOTE_DURATIONS.has(note.duration) &&
    isOptionalBoolean(note.isRest) &&
    isOptionalBoolean(note.isSpacer) &&
    isOptionalBoolean(note.dotted) &&
    isOptionalBoolean(note.suppressAccidentals) &&
    isOptionalBoolean(note.tieToNext) &&
    isOptionalBoolean(note.slurStart) &&
    isOptionalBoolean(note.slurEnd) &&
    isOptionalBoolean(note.pedalStart) &&
    isOptionalBoolean(note.pedalEnd) &&
    (
      note.accidentals === undefined || (
        Array.isArray(note.accidentals) &&
        note.accidentals.length === note.keys.length &&
        note.accidentals.every((accidental) => accidental === null || (
          typeof accidental === 'string' && ACCIDENTALS.has(accidental)
        ))
      )
    ) &&
    (note.dynamic === undefined || (typeof note.dynamic === 'string' && DYNAMICS.has(note.dynamic))) &&
    (
      note.articulations === undefined || (
        Array.isArray(note.articulations) &&
        note.articulations.every((articulation) => (
          typeof articulation === 'string' && ARTICULATIONS.has(articulation)
        ))
      )
    ) &&
    (note.slurToNoteId === undefined || typeof note.slurToNoteId === 'string') &&
    (
      note.restOffset === undefined ||
      (typeof note.restOffset === 'number' && Number.isFinite(note.restOffset) && note.restOffset >= -6 && note.restOffset <= 6)
    ) &&
    (
      note.slurPlacement === undefined ||
      note.slurPlacement === 'above' ||
      note.slurPlacement === 'below'
    ) &&
    (
      note.drumMidi === undefined || (
        Array.isArray(note.drumMidi) &&
        note.drumMidi.length === note.keys.length &&
        note.drumMidi.every((midi) => Number.isInteger(midi) && midi >= 0 && midi <= 127)
      )
    ) &&
    (
      note.fingers === undefined || (
        Array.isArray(note.fingers) &&
        note.fingers.length === note.keys.length &&
        note.fingers.every((finger) => finger === null || (
          typeof finger === 'number' && Number.isInteger(finger) && finger >= 1 && finger <= 5
        ))
      )
    )
  );
}

function isMeasure(value: unknown): value is Measure {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    treble?: unknown;
    bass?: unknown;
    additionalTrebleVoices?: unknown;
    additionalBassVoices?: unknown;
    repeatStart?: unknown;
    repeatEnd?: unknown;
    chordSymbol?: unknown;
  };
  const voicesAreValid = (voices: unknown) => (
    voices === undefined || (
      Array.isArray(voices) &&
      voices.every((voice) => Array.isArray(voice) && voice.every(isNoteEntry))
    )
  );
  return (
    Array.isArray(candidate.treble) && candidate.treble.every(isNoteEntry) &&
    Array.isArray(candidate.bass) && candidate.bass.every(isNoteEntry) &&
    voicesAreValid(candidate.additionalTrebleVoices) &&
    voicesAreValid(candidate.additionalBassVoices) &&
    isOptionalBoolean(candidate.repeatStart) &&
    isOptionalBoolean(candidate.repeatEnd) &&
    (
      candidate.chordSymbol === undefined || (
        typeof candidate.chordSymbol === 'string' &&
        candidate.chordSymbol.length > 0 &&
        candidate.chordSymbol.length <= 16
      )
    )
  );
}

function isSynthControls(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const controls = value as Record<string, unknown>;
  return ['volume', 'tone', 'echo', 'sustain'].every((key) => (
    typeof controls[key] === 'number' &&
    Number.isFinite(controls[key]) &&
    (controls[key] as number) >= 0 &&
    (controls[key] as number) <= 1
  ));
}

function isSongTrack(value: unknown): value is SongTrack {
  if (!value || typeof value !== 'object') return false;
  const track = value as Partial<SongTrack>;
  return (
    typeof track.id === 'string' && track.id.length > 0 && track.id.length <= 200 &&
    typeof track.name === 'string' && track.name.length > 0 && track.name.length <= 500 &&
    (track.kind === 'pitched' || track.kind === 'percussion') &&
    typeof track.instrumentSound === 'string' && INSTRUMENT_SOUNDS.has(track.instrumentSound) &&
    isSynthControls(track.synthControls) &&
    isOptionalBoolean(track.muted) &&
    Array.isArray(track.measures) && track.measures.length > 0 && track.measures.length <= 10_000 &&
    track.measures.every(isMeasure) &&
    (
      track.staffLayout === undefined ||
      track.staffLayout === 'grand' ||
      track.staffLayout === 'treble-only' ||
      track.staffLayout === 'bass-only'
    ) &&
    (
      track.staffClefs === undefined || (
        typeof track.staffClefs === 'object' && track.staffClefs !== null &&
        Object.values(track.staffClefs).every((clef) => (
          clef === 'treble' || clef === 'bass' || clef === 'percussion'
        ))
      )
    ) &&
    (
      track.voiceLabels === undefined || (
        typeof track.voiceLabels === 'object' && track.voiceLabels !== null &&
        Object.values(track.voiceLabels).every((labels) => (
          Array.isArray(labels) && labels.every((label) => typeof label === 'string')
        ))
      )
    ) &&
    (
      track.midi === undefined || (
        typeof track.midi === 'object' && track.midi !== null &&
        Number.isInteger(track.midi.channel) && track.midi.channel >= 0 && track.midi.channel <= 15 &&
        Number.isInteger(track.midi.program) && track.midi.program >= 0 && track.midi.program <= 127 &&
        typeof track.midi.instrumentName === 'string' &&
        typeof track.midi.family === 'string'
      )
    )
  );
}

interface LegacySongFields {
  id?: unknown;
  title?: unknown;
  tempo?: unknown;
  timeSignature?: unknown;
  keySignature?: unknown;
  staffLayout?: SongTrack['staffLayout'];
  staffClefs?: SongTrack['staffClefs'];
  voiceLabels?: SongTrack['voiceLabels'];
  measures?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function migrateLegacySong(candidate: LegacySongFields): Song {
  const id = typeof candidate.id === 'string' ? candidate.id : '';
  const voiceName = candidate.voiceLabels?.treble?.[0]
    ?? candidate.voiceLabels?.bass?.[0]
    ?? 'Piano';
  return {
    schemaVersion: CURRENT_SONG_SCHEMA_VERSION,
    id,
    title: candidate.title as string,
    tempo: candidate.tempo as number,
    timeSignature: candidate.timeSignature as [number, number],
    keySignature: candidate.keySignature as string,
    tracks: [{
      id: `${id || 'song'}-track-1`,
      name: voiceName,
      kind: 'pitched',
      instrumentSound: 'grand-piano',
      synthControls: { ...DEFAULT_TRACK_SYNTH_CONTROLS },
      staffLayout: candidate.staffLayout,
      staffClefs: candidate.staffClefs,
      voiceLabels: candidate.voiceLabels,
      measures: candidate.measures as Measure[],
    }],
    createdAt: candidate.createdAt as number,
    updatedAt: candidate.updatedAt as number,
  };
}

interface SongValidationResult {
  song: Song | null;
  errors: string[];
  migrated: boolean;
}

export function validateAndMigrateSong(value: unknown): SongValidationResult {
  if (!value || typeof value !== 'object') {
    return { song: null, errors: ['Song data must be an object'], migrated: false };
  }
  const candidate = value as Partial<Song> & LegacySongFields & { schemaVersion?: unknown };
  const errors: string[] = [];
  const schemaVersion = candidate.schemaVersion ?? 0;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    errors.push('schemaVersion must be an integer');
  } else if (schemaVersion > CURRENT_SONG_SCHEMA_VERSION) {
    errors.push(`This song uses newer schema version ${schemaVersion}`);
  } else if (schemaVersion < 0) {
    errors.push('schemaVersion cannot be negative');
  }

  const song = typeof schemaVersion === 'number' && schemaVersion < 2
    ? migrateLegacySong(candidate)
    : { ...candidate, schemaVersion: CURRENT_SONG_SCHEMA_VERSION } as Song;
  const hasValidShape = (
    typeof song.id === 'string' && song.id.length > 0 &&
    typeof song.title === 'string' && song.title.length <= 500 &&
    typeof song.tempo === 'number' && Number.isFinite(song.tempo) &&
    song.tempo >= 20 && song.tempo <= 300 &&
    typeof song.keySignature === 'string' && KEY_SIGNATURE_SET.has(song.keySignature) &&
    Array.isArray(song.timeSignature) && song.timeSignature.length === 2 &&
    Number.isInteger(song.timeSignature[0]) &&
    song.timeSignature[0] >= 1 && song.timeSignature[0] <= 32 &&
    Number.isInteger(song.timeSignature[1]) &&
    TIME_SIGNATURE_DENOMINATORS.has(song.timeSignature[1]) &&
    Array.isArray(song.tracks) && song.tracks.length > 0 && song.tracks.length <= 256 &&
    song.tracks.every(isSongTrack) &&
    typeof song.createdAt === 'number' && Number.isFinite(song.createdAt) &&
    typeof song.updatedAt === 'number' && Number.isFinite(song.updatedAt)
  );
  if (!hasValidShape) errors.push('The song contains invalid or unsupported fields');

  if (hasValidShape) {
    const noteIds = new Set<string>();
    const trackIds = new Set<string>();
    const slurTargets: Array<{ sourceId: string; targetId: string }> = [];
    const capacity = getMeasureCapacity(song.timeSignature);
    song.tracks.forEach((track) => {
      if (trackIds.has(track.id)) errors.push(`Duplicate track id: ${track.id}`);
      trackIds.add(track.id);
      track.measures.forEach((measure, measureIdx) => {
        for (const clef of ['treble', 'bass'] as const) {
          getMeasureVoices(measure, clef).forEach((voice, voiceIdx) => {
            if (getMeasureBeatCount(voice) > capacity + 1e-9) {
              errors.push(`${track.name}, bar ${measureIdx + 1}, ${clef} voice ${voiceIdx + 1} exceeds the time signature`);
            }
            voice.forEach((note) => {
              if (noteIds.has(note.id)) errors.push(`Duplicate note id: ${note.id}`);
              noteIds.add(note.id);
              if (note.slurToNoteId) slurTargets.push({ sourceId: note.id, targetId: note.slurToNoteId });
            });
          });
        }
      });
    });
    slurTargets.forEach(({ sourceId, targetId }) => {
      if (sourceId === targetId || !noteIds.has(targetId)) {
        errors.push(`Invalid slur from ${sourceId} to ${targetId}`);
      }
    });
  }

  return {
    song: errors.length === 0 ? song : null,
    errors,
    migrated: schemaVersion !== CURRENT_SONG_SCHEMA_VERSION,
  };
}

export function loadSongs(): Song[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    const results = parsed.map((candidate) => validateAndMigrateSong(candidate));
    const migrated = results.some((result) => result.migrated);
    const allValid = results.every((result) => result.song !== null);
    const songs = results.flatMap((result) => {
      return result.song ? [result.song] : [];
    });
    if (migrated && allValid) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
      } catch {
        // Reading remains available even when a migration cannot be persisted.
      }
    }
    return songs;
  } catch {
    return [];
  }
}

/**
 * Adds each bundled sample once without replacing local edits. Matching titles
 * also prevent duplicates for people who imported a fixture before it became
 * part of the starter library. Bumping the version lets a future release add
 * more samples while preserving anything the user has created or deleted.
 */
export function initializeSongLibrary(): Song[] {
  const songs = loadSongs();

  try {
    if (localStorage.getItem(SAMPLE_LIBRARY_VERSION_KEY) === SAMPLE_LIBRARY_VERSION) {
      return songs;
    }

    const existingIds = new Set(songs.map((song) => song.id));
    const existingTitles = new Set(songs.map((song) => song.title.trim().toLocaleLowerCase()));
    const samples = BUNDLED_SAMPLE_CANDIDATES.flatMap((candidate) => {
      const result = validateAndMigrateSong(candidate);
      return result.song ? [result.song] : [];
    });
    const missingSamples = samples.filter((sample) => (
      !existingIds.has(sample.id) &&
      !existingTitles.has(sample.title.trim().toLocaleLowerCase())
    ));
    const initializedSongs = missingSamples.length > 0
      ? [...songs, ...missingSamples]
      : songs;

    missingSamples.forEach(saveSong);
    localStorage.setItem(SAMPLE_LIBRARY_VERSION_KEY, SAMPLE_LIBRARY_VERSION);
    return initializedSongs;
  } catch {
    return songs;
  }
}

export function saveSongs(songs: Song[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs.map((song) => ({
      ...song,
      schemaVersion: CURRENT_SONG_SCHEMA_VERSION,
    }))));
  } catch (error) {
    throw new Error(
      error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'Browser storage is full. Export or remove a song, then try again.'
        : 'This browser could not save your songs locally.',
    );
  }
}

export function saveSong(song: Song): void {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = data ? JSON.parse(data) : [];
    if (!Array.isArray(parsed)) {
      throw new Error('The stored song library is not an array.');
    }
    const storedSong = { ...song, schemaVersion: CURRENT_SONG_SCHEMA_VERSION };
    const idx = parsed.findIndex((candidate) => (
      candidate !== null && typeof candidate === 'object' &&
      (candidate as { id?: unknown }).id === song.id
    ));
    if (idx >= 0) parsed[idx] = storedSong;
    else parsed.push(storedSong);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch (error) {
    if (error instanceof Error && error.message === 'The stored song library is not an array.') {
      throw new Error('The saved song library is unreadable, so it was left untouched.');
    }
    throw new Error(
      error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'Browser storage is full. Export or remove a song, then try again.'
        : 'This browser could not save your songs locally.',
    );
  }
}

export function deleteSong(id: string): void {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = data ? JSON.parse(data) : [];
    if (!Array.isArray(parsed)) {
      throw new Error('The stored song library is not an array.');
    }
    const songs = parsed.filter((candidate) => !(
      candidate !== null && typeof candidate === 'object' &&
      (candidate as { id?: unknown }).id === id
    ));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  } catch (error) {
    if (error instanceof Error && error.message === 'The stored song library is not an array.') {
      throw new Error('The saved song library is unreadable, so it was left untouched.');
    }
    throw new Error(
      error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'Browser storage is full. Export or remove a song, then try again.'
        : 'This browser could not update your saved songs.',
    );
  }
}

export function setCurrentSongId(id: string): void {
  try {
    localStorage.setItem(CURRENT_SONG_KEY, id);
  } catch {
    // The song itself remains usable even if this convenience pointer fails.
  }
}

export function getCurrentSongId(): string | null {
  try {
    return localStorage.getItem(CURRENT_SONG_KEY);
  } catch {
    return null;
  }
}

export function exportSongToJson(song: Song): void {
  const blob = new Blob([JSON.stringify(song, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${song.title.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importSongFromJson(file: File): Promise<Song> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(reader.result as string);
        const result = validateAndMigrateSong(parsed);
        if (!result.song) {
          reject(new Error(result.errors[0] ?? 'Invalid song file'));
          return;
        }
        resolve(result.song);
      } catch {
        reject(new Error('Failed to parse JSON'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
