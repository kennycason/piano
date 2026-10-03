import { afterEach, describe, expect, it, vi } from 'vitest';
import marinesHymn from '../../songs/marines-hymn.json';
import lowerNorfair from '../../songs/lower-norfair.json';
import moonlightSonata from '../../songs/moonlight-sonata.json';
import alouetteBeginner from '../../songs/alouette-beginner.json';
import tuFaltaDeQuerer from '../../songs/tu-falta-de-querer.json';
import { createDefaultSong, CURRENT_SONG_SCHEMA_VERSION } from '../models/song';
import {
  DEFAULT_STARTER_SONG_ID,
  initializeSongLibrary,
  saveSong,
  validateAndMigrateSong,
} from './storage';

const fixtures = import.meta.glob('../../songs/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

describe('song validation and migration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('migrates legacy songs that predate schemaVersion', () => {
    const current = createDefaultSong();
    const track = current.tracks[0];
    const legacy = {
      id: current.id,
      title: current.title,
      tempo: current.tempo,
      timeSignature: current.timeSignature,
      keySignature: current.keySignature,
      measures: track.measures,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    };
    const result = validateAndMigrateSong(legacy);
    expect(result.errors).toEqual([]);
    expect(result.migrated).toBe(true);
    expect(result.song?.schemaVersion).toBe(CURRENT_SONG_SCHEMA_VERSION);
  });

  it('accepts the full Marines Hymn fixture with its cross-measure ties', () => {
    const result = validateAndMigrateSong(marinesHymn);
    expect(result.errors).toEqual([]);
    expect(result.song?.tracks[0].measures).toHaveLength(25);
  });

  it('keeps every checked-in song fixture valid', () => {
    Object.entries(fixtures).forEach(([path, fixture]) => {
      const result = validateAndMigrateSong(fixture);
      expect(result.errors, path).toEqual([]);
    });
  });

  it('keeps the bundled multitrack and corrected Moonlight projects intact', () => {
    const lower = validateAndMigrateSong(lowerNorfair);
    const moonlight = validateAndMigrateSong(moonlightSonata);

    expect(lower.song?.tracks.map((track) => track.name)).toEqual([
      'Strings', 'Drums', 'Ahhs', 'Lead',
    ]);
    expect(lower.song?.tracks.find((track) => track.kind === 'percussion')?.instrumentSound)
      .toBe('drum-kit');
    expect(moonlight.song?.keySignature).toBe('E');
    expect(moonlight.song?.tracks[0].staffClefs?.treble).toBe('treble');
  });

  it('keeps the Tu Falta practice chart in Bb with the tutorial voicings', () => {
    const result = validateAndMigrateSong(tuFaltaDeQuerer);
    expect(result.errors).toEqual([]);
    const measures = result.song?.tracks[0].measures ?? [];
    expect(measures).toHaveLength(32);
    expect(result.song?.keySignature).toBe('Bb');
    expect(result.song?.timeSignature).toEqual([4, 4]);
    expect(measures[0].chordSymbol).toBe('Bb');
    expect(measures[0].bass[0].keys).toEqual(['f/2', 'bb/2', 'd/3']);
    expect(measures[0].bass[0].fingers).toEqual([5, 3, 1]);
    expect(measures[0].treble.map((note) => note.keys[0])).toEqual(['d/4', 'bb/3', 'f/3', 'd/4']);
    expect(measures[2].chordSymbol).toBe('G');
    expect(measures[2].bass[0].keys).toEqual(['g/2', 'b/2', 'd/3']);
    expect(measures[2].bass[0].accidentals).toEqual([null, 'n', null]);
    expect(measures[4].chordSymbol).toBe('Eb');
    expect(measures[5].chordSymbol).toBe('Ebm');
    expect(measures[5].bass[0].keys).toEqual(['gb/2', 'bb/2', 'eb/3']);
    expect(measures[6].chordSymbol).toBe('Cm');
    expect(measures[6].bass[0].fingers).toEqual([5, 2, 1]);
    expect(measures[18].chordSymbol).toBe('D');
    expect(measures[18].bass[0].keys).toEqual(['f#/2', 'a/2', 'd/3']);
    expect(measures[18].bass[0].fingers).toEqual([5, 3, 1]);
  });

  it('uses Alouette as the first-run song', () => {
    expect(DEFAULT_STARTER_SONG_ID).toBe('fixture-alouette-beginner');
  });

  it('adds Lower Norfair when upgrading an existing starter library', () => {
    const stored = new Map<string, string>([
      ['piano_sheet_songs', JSON.stringify([alouetteBeginner])],
      ['piano_sheet_sample_library_version', '3'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
    });

    const songs = initializeSongLibrary();

    expect(songs.some((song) => song.id === 'lower-norfair-multitrack')).toBe(true);
    expect(stored.get('piano_sheet_sample_library_version')).toBe('5');
  });

  it('rejects unsupported keys, overflowing voices, and duplicate note ids', () => {
    const invalid = createDefaultSong();
    invalid.keySignature = 'H';
    invalid.tracks[0].measures[0].treble = Array.from({ length: 5 }, () => ({
      id: 'duplicate', keys: ['c/4'], duration: 'q' as const,
    }));
    const result = validateAndMigrateSong(invalid);
    expect(result.song).toBeNull();
    expect(result.errors.some((error) => error.includes('invalid or unsupported'))).toBe(true);
  });

  it('rejects songs created by a newer incompatible schema', () => {
    const future = { ...createDefaultSong(), schemaVersion: CURRENT_SONG_SCHEMA_VERSION + 1 };
    const result = validateAndMigrateSong(future);
    expect(result.song).toBeNull();
    expect(result.errors[0]).toContain('newer schema');
  });

  it('preserves unreadable song entries when another song is saved', () => {
    let stored = JSON.stringify([{ id: 'damaged-song', unexpected: true }]);
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: (_key: string, value: string) => { stored = value; },
    });

    const valid = createDefaultSong();
    saveSong(valid);

    const parsed = JSON.parse(stored) as Array<{ id: string; unexpected?: boolean }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: 'damaged-song', unexpected: true });
    expect(parsed[1].id).toBe(valid.id);
  });
});
