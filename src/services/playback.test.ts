import { describe, expect, it } from 'vitest';
import { createDefaultSong } from '../models/song';
import { getPlaybackOrder } from './playback';

describe('repeat expansion', () => {
  it('plays a marked repeat section exactly twice', () => {
    const song = createDefaultSong();
    song.tracks[0].measures[1].repeatStart = true;
    song.tracks[0].measures[2].repeatEnd = true;
    expect(getPlaybackOrder(song.tracks[0])).toEqual([0, 1, 2, 1, 2, 3]);
  });

  it('repeats from the beginning when no explicit start marker exists', () => {
    const song = createDefaultSong();
    song.tracks[0].measures[1].repeatEnd = true;
    expect(getPlaybackOrder(song.tracks[0])).toEqual([0, 1, 0, 1, 2, 3]);
  });
});
