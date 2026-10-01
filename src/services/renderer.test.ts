import { describe, expect, it } from 'vitest';
import {
  getPlaybackAnchorX,
  getContinuousPlaybackEndX,
  getPlaybackCursorX,
  getRenderedVoiceLabel,
  shouldUsePlaybackAnchor,
} from './renderer';

describe('score voice labels', () => {
  it('hides labels that merely repeat the selected track name', () => {
    expect(getRenderedVoiceLabel('Melody', 'Melody')).toBeUndefined();
    expect(getRenderedVoiceLabel(' Lead ', 'Lead')).toBeUndefined();
  });

  it('removes a redundant track prefix while preserving the voice distinction', () => {
    expect(getRenderedVoiceLabel('Drums · voice 2', 'Drums')).toBe('Voice 2');
  });

  it('preserves hand and descriptive voice labels', () => {
    expect(getRenderedVoiceLabel('R.H.', 'R.H.')).toBe('R.H.');
    expect(getRenderedVoiceLabel('L.H.', 'Melody')).toBe('L.H.');
    expect(getRenderedVoiceLabel('Arpeggio', 'Piano')).toBe('Arpeggio');
  });
});

describe('playback cursor position', () => {
  const anchors = [
    { progress: 0, x: 100 },
    { progress: 0.25, x: 150 },
    { progress: 1, x: 300 },
  ];

  it('lands on the rendered note position at each rhythmic onset', () => {
    expect(getPlaybackCursorX(anchors, 0)).toBe(100);
    expect(getPlaybackCursorX(anchors, 0.25)).toBe(150);
    expect(getPlaybackCursorX(anchors, 1)).toBe(300);
  });

  it('interpolates between note positions and clamps outside the measure', () => {
    expect(getPlaybackCursorX(anchors, 0.125)).toBe(125);
    expect(getPlaybackCursorX(anchors, 0.5)).toBe(200);
    expect(getPlaybackCursorX(anchors, -1)).toBe(100);
    expect(getPlaybackCursorX(anchors, 2)).toBe(300);
  });

  it('continues to the next downbeat on the same staff row', () => {
    expect(getContinuousPlaybackEndX(
      { x: 40, y: 120 },
      { x: 320, y: 120, playbackAnchors: [{ progress: 0, x: 374 }] },
    )).toBe(374);
  });

  it('wraps normally instead of connecting across staff rows', () => {
    expect(getContinuousPlaybackEndX(
      { x: 880, y: 120 },
      { x: 40, y: 370, playbackAnchors: [{ progress: 0, x: 98 }] },
    )).toBeNull();
  });

  it('anchors to a sounding note instead of a simultaneous centered rest', () => {
    expect(getPlaybackAnchorX([
      { x: 116, kind: 'note' },
      { x: 216, kind: 'rest' },
    ])).toBe(116);
  });

  it('uses the leftmost sounding onset when independently formatted staves differ', () => {
    expect(getPlaybackAnchorX([
      { x: 124, kind: 'note' },
      { x: 132, kind: 'note' },
      { x: 98, kind: 'spacer' },
    ])).toBe(124);
  });

  it('ignores centered whole-measure rests when another staff is sounding', () => {
    expect(shouldUsePlaybackAnchor('measure-rest', true)).toBe(false);
    expect(shouldUsePlaybackAnchor('note', true)).toBe(true);
    expect(shouldUsePlaybackAnchor('measure-rest', false)).toBe(true);
  });
});
