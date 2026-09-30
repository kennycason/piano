import type { Song } from '../models/song';
import alouetteBeginner from '../../songs/alouette-beginner.json';
import marinesHymnBeginner from '../../songs/marines-hymn-beginner.json';
import orbitingRuins from '../../songs/orbiting-ruins.json';
import pixelParade from '../../songs/pixel-parade.json';
import teacherDuetSingleBassStaff from '../../songs/teacher-duet-single-bass-staff.json';

const STORAGE_KEY = 'piano_sheet_songs';
const CURRENT_SONG_KEY = 'piano_sheet_current';
const SAMPLE_LIBRARY_VERSION_KEY = 'piano_sheet_sample_library_version';
const SAMPLE_LIBRARY_VERSION = '1';
const NOTE_DURATIONS = new Set(['w', 'h', 'q', '8', '16']);
const BUNDLED_SAMPLE_CANDIDATES: unknown[] = [
  alouetteBeginner,
  marinesHymnBeginner,
  orbitingRuins,
  pixelParade,
  teacherDuetSingleBassStaff,
];

function isNoteEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const note = value as {
    id?: unknown;
    keys?: unknown;
    duration?: unknown;
    slurPlacement?: unknown;
    restOffset?: unknown;
  };
  return (
    typeof note.id === 'string' &&
    Array.isArray(note.keys) &&
    note.keys.length > 0 &&
    note.keys.every((key) => typeof key === 'string' && /^[a-g](?:#|b)?\/\d$/.test(key)) &&
    typeof note.duration === 'string' &&
    NOTE_DURATIONS.has(note.duration) &&
    (
      note.restOffset === undefined ||
      (typeof note.restOffset === 'number' && Number.isFinite(note.restOffset) && note.restOffset >= -6 && note.restOffset <= 6)
    ) &&
    (
      note.slurPlacement === undefined ||
      note.slurPlacement === 'above' ||
      note.slurPlacement === 'below'
    )
  );
}

function isSong(value: unknown): value is Song {
  if (!value || typeof value !== 'object') return false;
  const song = value as Partial<Song>;
  return (
    typeof song.id === 'string' &&
    typeof song.title === 'string' &&
    typeof song.tempo === 'number' &&
    Number.isFinite(song.tempo) &&
    song.tempo >= 20 &&
    song.tempo <= 300 &&
    typeof song.keySignature === 'string' &&
    Array.isArray(song.timeSignature) &&
    song.timeSignature.length === 2 &&
    song.timeSignature.every((value) => typeof value === 'number' && value > 0) &&
    Array.isArray(song.measures) &&
    song.measures.length > 0 &&
    song.measures.every((measure) => {
      if (measure === null || typeof measure !== 'object') return false;
      const candidate = measure as {
        treble?: unknown;
        bass?: unknown;
        additionalTrebleVoices?: unknown;
        additionalBassVoices?: unknown;
      };
      const voicesAreValid = (voices: unknown) => (
        voices === undefined || (
          Array.isArray(voices) &&
          voices.every((voice) => Array.isArray(voice) && voice.every(isNoteEntry))
        )
      );
      return (
        Array.isArray(candidate.treble) &&
        candidate.treble.every(isNoteEntry) &&
        Array.isArray(candidate.bass) &&
        candidate.bass.every(isNoteEntry) &&
        voicesAreValid(candidate.additionalTrebleVoices) &&
        voicesAreValid(candidate.additionalBassVoices)
      );
    }) &&
    (
      song.staffLayout === undefined ||
      song.staffLayout === 'grand' ||
      song.staffLayout === 'treble-only' ||
      song.staffLayout === 'bass-only'
    ) &&
    (
      song.staffClefs === undefined || (
        typeof song.staffClefs === 'object' &&
        song.staffClefs !== null &&
        Object.values(song.staffClefs).every((clef) => clef === 'treble' || clef === 'bass')
      )
    ) &&
    (
      song.voiceLabels === undefined || (
        typeof song.voiceLabels === 'object' &&
        song.voiceLabels !== null &&
        Object.values(song.voiceLabels).every((labels) => (
          Array.isArray(labels) && labels.every((label) => typeof label === 'string')
        ))
      )
    )
  );
}

export function loadSongs(): Song[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed: unknown = JSON.parse(data);
    return Array.isArray(parsed) ? parsed.filter(isSong) : [];
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
    const samples = BUNDLED_SAMPLE_CANDIDATES.filter(isSong);
    const missingSamples = samples.filter((sample) => (
      !existingIds.has(sample.id) &&
      !existingTitles.has(sample.title.trim().toLocaleLowerCase())
    ));
    const initializedSongs = missingSamples.length > 0
      ? [...songs, ...missingSamples]
      : songs;

    if (missingSamples.length > 0) saveSongs(initializedSongs);
    localStorage.setItem(SAMPLE_LIBRARY_VERSION_KEY, SAMPLE_LIBRARY_VERSION);
    return initializedSongs;
  } catch {
    return songs;
  }
}

export function saveSongs(songs: Song[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

export function saveSong(song: Song): void {
  const songs = loadSongs();
  const idx = songs.findIndex((s) => s.id === song.id);
  if (idx >= 0) {
    songs[idx] = song;
  } else {
    songs.push(song);
  }
  saveSongs(songs);
}

export function deleteSong(id: string): void {
  const songs = loadSongs().filter((s) => s.id !== id);
  saveSongs(songs);
}

export function setCurrentSongId(id: string): void {
  localStorage.setItem(CURRENT_SONG_KEY, id);
}

export function getCurrentSongId(): string | null {
  return localStorage.getItem(CURRENT_SONG_KEY);
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
        const song: unknown = JSON.parse(reader.result as string);
        if (!isSong(song)) {
          reject(new Error('Invalid song file'));
          return;
        }
        resolve(song);
      } catch {
        reject(new Error('Failed to parse JSON'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
