import React from 'react';
import VexFlow from 'vexflow';
import type { NoteDuration } from '../../models/song';

export const NotationGlyphs = VexFlow.Glyphs;

interface NotationGlyphProps {
  glyph: string;
  className?: string;
}

export const NotationGlyph: React.FC<NotationGlyphProps> = ({ glyph, className = '' }) => (
  <span className={`notation-glyph ${className}`.trim()} aria-hidden="true">
    {glyph}
  </span>
);

export const WholeNote: React.FC = () => (
  <NotationGlyph glyph={NotationGlyphs.noteWhole} className="duration-glyph whole-note-glyph" />
);

export const HalfNote: React.FC = () => (
  <NotationGlyph glyph={NotationGlyphs.noteHalfUp} className="duration-glyph stemmed-note-glyph" />
);

export const QuarterNote: React.FC = () => (
  <NotationGlyph glyph={NotationGlyphs.noteQuarterUp} className="duration-glyph stemmed-note-glyph" />
);

export const EighthNote: React.FC = () => (
  <NotationGlyph glyph={NotationGlyphs.note8thUp} className="duration-glyph stemmed-note-glyph" />
);

export const SixteenthNote: React.FC = () => (
  <NotationGlyph glyph={NotationGlyphs.note16thUp} className="duration-glyph stemmed-note-glyph" />
);

const restGlyphs: Record<NoteDuration, string> = {
  w: NotationGlyphs.restWhole,
  h: NotationGlyphs.restHalf,
  q: NotationGlyphs.restQuarter,
  '8': NotationGlyphs.rest8th,
  '16': NotationGlyphs.rest16th,
};

export const RestIcon: React.FC<{ duration: NoteDuration }> = ({ duration }) => (
  <NotationGlyph glyph={restGlyphs[duration]} className={`rest-glyph rest-glyph-${duration}`} />
);

export const DotIcon: React.FC = () => (
  <span className="dotted-note-glyph" aria-hidden="true">
    <NotationGlyph glyph={NotationGlyphs.noteQuarterUp} className="duration-glyph stemmed-note-glyph" />
    <NotationGlyph glyph={NotationGlyphs.augmentationDot} className="augmentation-dot-glyph" />
  </span>
);

/** A tie includes its noteheads so it remains distinct from the phrase-slur tool. */
export const TieIcon: React.FC = () => (
  <svg width="25" height="15" viewBox="0 0 25 15" aria-hidden="true">
    <ellipse cx="4" cy="5" rx="3.2" ry="2.2" fill="currentColor" transform="rotate(-14 4 5)" />
    <ellipse cx="21" cy="5" rx="3.2" ry="2.2" fill="currentColor" transform="rotate(-14 21 5)" />
    <path d="M5 8 Q12.5 14 20 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const SlurIcon: React.FC = () => (
  <svg width="25" height="15" viewBox="0 0 25 15" aria-hidden="true">
    <path d="M2 12 Q12.5 1 23 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
