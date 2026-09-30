import { describe, expect, it } from 'vitest';
import { createDefaultSong } from '../models/song';
import { getPlaybackOrder } from './playback';

describe('repeat expansion', () => {
  it('plays a marked repeat section exactly twice', () => {
    const song = createDefaultSong();
    song.measures[1].repeatStart = true;
    song.measures[2].repeatEnd = true;
    expect(getPlaybackOrder(song)).toEqual([0, 1, 2, 1, 2, 3]);
  });

  it('repeats from the beginning when no explicit start marker exists', () => {
    const song = createDefaultSong();
    song.measures[1].repeatEnd = true;
    expect(getPlaybackOrder(song)).toEqual([0, 1, 0, 1, 2, 3]);
  });
});
