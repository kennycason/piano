import React from 'react';
import type { NoteDuration, Accidental, Dynamic, Articulation, NoteEntry } from '../../models/song';
import {
  WholeNote,
  HalfNote,
  QuarterNote,
  EighthNote,
  SixteenthNote,
  RestIcon,
  DotIcon,
  TieIcon,
  SlurIcon,
  NotationGlyph,
  NotationGlyphs,
} from './NoteIcons';
import './Toolbar.css';

interface ToolbarProps {
  selectedDuration: NoteDuration;
  onDurationChange: (d: NoteDuration) => void;
  isRestMode: boolean;
  onRestModeToggle: () => void;
  isDotted: boolean;
  onDottedToggle: () => void;
  onRestMove: (direction: -1 | 1) => void;
  onRestReset: () => void;
  onAccidental: (a: Accidental) => void;
  onDynamic: (d: Dynamic) => void;
  onArticulation: (a: Articulation) => void;
  onTie: () => void;
  onSlurToolToggle: () => void;
  isSlurToolActive: boolean;
  isSlurStartPending: boolean;
  onPedalStart: () => void;
  onPedalEnd: () => void;
  onRepeatStart: () => void;
  onRepeatEnd: () => void;
  onAddMeasure: () => void;
  onDeleteNote: () => void;
  onDeleteMeasure: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canDeleteMeasure: boolean;
  selectedNote: NoteEntry | null;
}

const durationIcons: Record<NoteDuration, React.FC> = {
  w: WholeNote,
  h: HalfNote,
  q: QuarterNote,
  '8': EighthNote,
  '16': SixteenthNote,
};

const durationNames: Record<NoteDuration, string> = {
  w: 'Whole note',
  h: 'Half note',
  q: 'Quarter note',
  '8': 'Eighth note',
  '16': 'Sixteenth note',
};

const durations: { value: NoteDuration; shortcut: string }[] = [
  { value: 'w', shortcut: '1' },
  { value: 'h', shortcut: '2' },
  { value: 'q', shortcut: '3' },
  { value: '8', shortcut: '4' },
  { value: '16', shortcut: '5' },
];

const dynamics: { value: Dynamic; glyph: string; tip: string }[] = [
  { value: 'pp', glyph: NotationGlyphs.dynamicPP, tip: 'Pianissimo - Very soft' },
  { value: 'p', glyph: NotationGlyphs.dynamicPiano, tip: 'Piano - Soft' },
  { value: 'mp', glyph: NotationGlyphs.dynamicMP, tip: 'Mezzo-piano - Moderately soft' },
  { value: 'mf', glyph: NotationGlyphs.dynamicMF, tip: 'Mezzo-forte - Moderately loud' },
  { value: 'f', glyph: NotationGlyphs.dynamicForte, tip: 'Forte - Loud' },
  { value: 'ff', glyph: NotationGlyphs.dynamicFF, tip: 'Fortissimo - Very loud' },
];

const articulations: { value: Articulation; glyph: string; tip: string }[] = [
  { value: 'staccato', glyph: NotationGlyphs.articStaccatoAbove, tip: 'Staccato - Short, detached' },
  { value: 'fermata', glyph: NotationGlyphs.fermataAbove, tip: 'Fermata - Hold/pause' },
  { value: 'accent', glyph: NotationGlyphs.articAccentAbove, tip: 'Accent - Emphasize note' },
  { value: 'tenuto', glyph: NotationGlyphs.articTenutoAbove, tip: 'Tenuto - Sustain full value' },
];

// Tooltip wrapper component
const Tip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => (
  <div className="tooltip-wrapper" data-tooltip={text}>
    {children}
  </div>
);

export const Toolbar: React.FC<ToolbarProps> = ({
  selectedDuration,
  onDurationChange,
  isRestMode,
  onRestModeToggle,
  isDotted,
  onDottedToggle,
  onRestMove,
  onRestReset,
  onAccidental,
  onDynamic,
  onArticulation,
  onTie,
  onSlurToolToggle,
  isSlurToolActive,
  isSlurStartPending,
  onPedalStart,
  onPedalEnd,
  onRepeatStart,
  onRepeatEnd,
  onAddMeasure,
  onDeleteNote,
  onDeleteMeasure,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  canDeleteMeasure,
  selectedNote,
}) => {
  const hasAccidental = (a: Accidental) => selectedNote?.accidentals?.some((x) => x === a) ?? false;
  const hasDynamic = (d: Dynamic) => selectedNote?.dynamic === d;
  const hasArticulation = (a: Articulation) => selectedNote?.articulations?.includes(a) ?? false;

  return (
    <div className="toolbar" role="toolbar" aria-label="Music notation tools">
      {/* Undo / Redo */}
      <div className="toolbar-section">
        <div className="toolbar-group">
          <Tip text="Undo (Ctrl+Z)">
            <button type="button" className="toolbar-btn" onClick={onUndo} disabled={!canUndo} aria-label="Undo">
              <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
                <path d="M5 3 L1 7 L5 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M1.5 7 L10 7 Q14 7, 14 11 Q14 14, 10 14 L8 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          </Tip>
          <Tip text="Redo (Ctrl+Y)">
            <button type="button" className="toolbar-btn" onClick={onRedo} disabled={!canRedo} aria-label="Redo">
              <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
                <path d="M11 3 L15 7 L11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14.5 7 L6 7 Q2 7, 2 11 Q2 14, 6 14 L8 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          </Tip>
        </div>
      </div>

      {/* Note durations */}
      <div className="toolbar-section">
        <span className="toolbar-label">Notes</span>
        <div className="toolbar-group">
          {durations.map((d) => {
            const Icon = durationIcons[d.value];
            return (
              <Tip key={d.value} text={`${durationNames[d.value]} (${d.shortcut})`}>
                <button
                  type="button"
                  className={`toolbar-btn note-icon-btn ${selectedDuration === d.value ? 'active' : ''}`}
                  onClick={() => onDurationChange(d.value)}
                  aria-label={`${durationNames[d.value]} (${d.shortcut})`}
                  aria-pressed={selectedDuration === d.value}
                >
                  <Icon />
                </button>
              </Tip>
            );
          })}
          <Tip text="Rest - Insert a silence (R)">
            <button
              type="button"
              className={`toolbar-btn note-icon-btn ${isRestMode ? 'active' : ''}`}
              onClick={onRestModeToggle}
              aria-label="Rest mode"
              aria-pressed={isRestMode}
            >
              <RestIcon />
            </button>
          </Tip>
          <Tip text="Dotted note - 1.5x duration (.)">
            <button
              type="button"
              className={`toolbar-btn note-icon-btn ${isDotted ? 'active' : ''}`}
              onClick={onDottedToggle}
              aria-label="Dotted note"
              aria-pressed={isDotted}
            >
              <DotIcon />
            </button>
          </Tip>
        </div>
      </div>

      {/* Rest layout */}
      <div className="toolbar-section">
        <span className="toolbar-label">Rest position</span>
        <div className="toolbar-group">
          <Tip text="Move the selected rest up">
            <button
              type="button"
              className="toolbar-btn rest-position-btn"
              onClick={() => onRestMove(1)}
              disabled={!selectedNote?.isRest}
              aria-label="Move selected rest up"
            >
              Rest ↑
            </button>
          </Tip>
          <Tip text="Move the selected rest down">
            <button
              type="button"
              className="toolbar-btn rest-position-btn"
              onClick={() => onRestMove(-1)}
              disabled={!selectedNote?.isRest}
              aria-label="Move selected rest down"
            >
              Rest ↓
            </button>
          </Tip>
          <Tip text="Return the selected rest to its voice's default position">
            <button
              type="button"
              className="toolbar-btn rest-position-btn"
              onClick={onRestReset}
              disabled={!selectedNote?.isRest || !selectedNote.restOffset}
              aria-label="Reset selected rest position"
            >
              Reset
            </button>
          </Tip>
        </div>
      </div>

      {/* Accidentals */}
      <div className="toolbar-section">
        <span className="toolbar-label">Accidentals</span>
        <div className="toolbar-group">
          <Tip text="Sharp - Raise pitch by a half step">
            <button type="button" className={`toolbar-btn ${hasAccidental('#') ? 'active' : ''}`} onClick={() => onAccidental('#')} disabled={!selectedNote} aria-label="Sharp">
              <NotationGlyph glyph={NotationGlyphs.accidentalSharp} className="accidental-glyph" />
            </button>
          </Tip>
          <Tip text="Flat - Lower pitch by a half step">
            <button type="button" className={`toolbar-btn ${hasAccidental('b') ? 'active' : ''}`} onClick={() => onAccidental('b')} disabled={!selectedNote} aria-label="Flat">
              <NotationGlyph glyph={NotationGlyphs.accidentalFlat} className="accidental-glyph" />
            </button>
          </Tip>
          <Tip text="Natural - Cancel sharp or flat">
            <button type="button" className={`toolbar-btn ${hasAccidental('n') ? 'active' : ''}`} onClick={() => onAccidental('n')} disabled={!selectedNote} aria-label="Natural">
              <NotationGlyph glyph={NotationGlyphs.accidentalNatural} className="accidental-glyph" />
            </button>
          </Tip>
        </div>
      </div>

      {/* Dynamics */}
      <div className="toolbar-section">
        <span className="toolbar-label">Dynamics</span>
        <div className="toolbar-group">
          {dynamics.map((d) => (
            <Tip key={d.value} text={d.tip}>
              <button
                type="button"
                className={`toolbar-btn dynamics-btn ${hasDynamic(d.value) ? 'active' : ''}`}
                onClick={() => onDynamic(d.value)}
                disabled={!selectedNote}
                aria-label={d.tip}
              >
                <NotationGlyph glyph={d.glyph} className="dynamic-glyph" />
              </button>
            </Tip>
          ))}
        </div>
      </div>

      {/* Articulations */}
      <div className="toolbar-section">
        <span className="toolbar-label">Articulations</span>
        <div className="toolbar-group">
          {articulations.map((a) => (
            <Tip key={a.value} text={a.tip}>
              <button
                type="button"
                className={`toolbar-btn ${hasArticulation(a.value) ? 'active' : ''}`}
                onClick={() => onArticulation(a.value)}
                disabled={!selectedNote}
                aria-label={a.tip}
              >
                <NotationGlyph glyph={a.glyph} className="articulation-glyph" />
              </button>
            </Tip>
          ))}
        </div>
      </div>

      {/* Connections */}
      <div className="toolbar-section">
        <span className="toolbar-label">Connections</span>
        <div className="toolbar-group">
          <Tip text="Tie - Connect two same-pitch notes into one sustained note (T)">
            <button type="button" className={`toolbar-btn note-icon-btn ${selectedNote?.tieToNext ? 'active' : ''}`} onClick={onTie} disabled={!selectedNote} aria-label="Tie to next note">
              <TieIcon />
            </button>
          </Tip>
          <Tip text={isSlurStartPending ? 'Select the ending note' : 'Slur - Select two notes to connect'}>
            <button
              type="button"
              className={`toolbar-btn note-icon-btn slur-tool-btn ${isSlurToolActive ? 'active' : ''} ${isSlurStartPending ? 'pending' : ''}`}
              onClick={onSlurToolToggle}
              aria-label={isSlurStartPending ? 'Select the ending note for the slur' : 'Create a slur between two notes'}
              aria-pressed={isSlurToolActive}
            >
              <SlurIcon />
              {isSlurStartPending && <span className="slur-step">2</span>}
            </button>
          </Tip>
          <Tip text="Sustain pedal on - Depress the right pedal here">
            <button type="button" className={`toolbar-btn pedal-action-btn ${selectedNote?.pedalStart ? 'active' : ''}`} onClick={onPedalStart} disabled={!selectedNote} aria-label="Sustain pedal on">
              Pedal On
            </button>
          </Tip>
          <Tip text="Sustain pedal off - Release the right pedal here">
            <button type="button" className={`toolbar-btn pedal-action-btn ${selectedNote?.pedalEnd ? 'active' : ''}`} onClick={onPedalEnd} disabled={!selectedNote} aria-label="Sustain pedal off">
              Pedal Off
            </button>
          </Tip>
        </div>
      </div>

      {/* Structure */}
      <div className="toolbar-section">
        <span className="toolbar-label">Structure</span>
        <div className="toolbar-group">
          <Tip text="Repeat start - Begin repeat section on this measure">
            <button type="button" className="toolbar-btn" onClick={onRepeatStart}>
              |:
            </button>
          </Tip>
          <Tip text="Repeat end - End repeat section on this measure">
            <button type="button" className="toolbar-btn" onClick={onRepeatEnd}>
              :|
            </button>
          </Tip>
          <Tip text="Add a new empty measure at the end">
            <button type="button" className="toolbar-btn add-btn" onClick={onAddMeasure}>
              + Bar
            </button>
          </Tip>
          <Tip text="Remove the measure containing the selected note">
            <button type="button" className="toolbar-btn danger-btn" onClick={onDeleteMeasure} disabled={!canDeleteMeasure}>
              - Bar
            </button>
          </Tip>
          <Tip text="Delete the selected note (Delete)">
            <button type="button" className="toolbar-btn danger-btn" onClick={onDeleteNote} disabled={!selectedNote}>
              Del Note
            </button>
          </Tip>
        </div>
      </div>
    </div>
  );
};
