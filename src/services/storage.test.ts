import { afterEach, describe, expect, it, vi } from 'vitest';
import marinesHymn from '../../songs/marines-hymn.json';
import lowerNorfair from '../../songs/lower-norfair.json';
import moonlightSonata from '../../songs/moonlight-sonata.json';
import { createDefaultSong, CURRENT_SONG_SCHEMA_VERSION } from '../models/song';
import { saveSong, validateAndMigrateSong } from './storage';

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
