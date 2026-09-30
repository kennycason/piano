import React, { useEffect, useState } from 'react';
import type { Accidental, NoteEntry } from '../../models/song';
import './NoteInput.css';

interface NoteInputProps {
  onAddNote: (keys: string[], clef: 'treble' | 'bass') => boolean;
  onUpdateSelectedKeys: (keys: string[]) => void;
  selectedNote: NoteEntry | null;
  session?: {
    mode: 'add' | 'edit';
    label: string;
  } | null;
  onPreviewKeysChange: (keys: string[]) => boolean;
  onSessionCommit: () => void;
  onSessionCancel: () => void;
  activePlaybackKeys: string[];
}

interface PianoKey {
  note: string;
  label: string;
  isBlack: boolean;
  clef: 'treble' | 'bass';
  midi: number;
  /** Black keys sit on the boundary after this many white keys. */
  whiteBoundary: number;
}

function buildFullKeyboard(): PianoKey[] {
  const pitchNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const keys: PianoKey[] = [];
  let whiteBoundary = 0;
  for (let midi = 21; midi <= 108; midi++) {
    const pitch = pitchNames[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    const isBlack = pitch.includes('#');
    keys.push({
      note: `${pitch}/${octave}`,
      label: `${pitch.toUpperCase()}${octave}`,
      isBlack,
      clef: midi < 60 ? 'bass' : 'treble',
      midi,
      whiteBoundary,
    });
    if (!isBlack) whiteBoundary++;
  }
  return keys;
}

// Standard 88-key piano: A0 through C8.
const ALL_KEYS = buildFullKeyboard();
const WHITE_KEYS = ALL_KEYS.filter((k) => !k.isBlack);
const BLACK_KEYS = ALL_KEYS.filter((k) => k.isBlack);
const TOTAL_WHITE_KEYS = WHITE_KEYS.length;
const MIDDLE_C_WHITE_INDEX = WHITE_KEYS.findIndex((key) => key.note === 'c/4');

function toPianoKey(key: string, accidental?: Accidental | null): string {
  const [name, octaveText] = key.split('/');
  const octave = Number(octaveText);
  const effectiveAccidental = accidental === 'n' ? '' : accidental ?? name.slice(1);
  const pitch = name[0];
  if (effectiveAccidental !== 'b') return `${pitch}${effectiveAccidental}/${octave}`;

  const flatToSharp: Record<string, [string, number]> = {
    c: ['b', -1], d: ['c#', 0], e: ['d#', 0], f: ['e', 0],
    g: ['f#', 0], a: ['g#', 0], b: ['a#', 0],
  };
  const [pianoPitch, octaveDelta] = flatToSharp[pitch] ?? [pitch, 0];
  return `${pianoPitch}/${octave + octaveDelta}`;
}

function sortPianoKeys(keys: Iterable<string>): string[] {
  const midiFor = (key: string) => {
    const [name, octaveText] = key.split('/');
    const pitchClasses: Record<string, number> = {
      c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
    };
    return (Number(octaveText) + 1) * 12
      + pitchClasses[name[0]]
      + (name.includes('#') ? 1 : name.includes('b') ? -1 : 0);
  };
  return Array.from(keys).sort((a, b) => midiFor(a) - midiFor(b));
}

export const NoteInput: React.FC<NoteInputProps> = ({
  onAddNote,
  onUpdateSelectedKeys,
  selectedNote,
  session,
  onPreviewKeysChange,
  onSessionCommit,
  onSessionCancel,
  activePlaybackKeys,
}) => {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => (
    session?.mode === 'edit' && selectedNote && !selectedNote.isRest
      ? new Set(selectedNote.keys.map((key, index) => (
          toPianoKey(key, selectedNote.accidentals?.[index])
        )))
      : new Set()
  ));
  const [isChordMode, setIsChordMode] = useState(Boolean(session));

  const playingKeys = new Set(activePlaybackKeys);
  const bassLabelLeft = (MIDDLE_C_WHITE_INDEX / 2 / TOTAL_WHITE_KEYS) * 100;
  const trebleLabelLeft = (
    (MIDDLE_C_WHITE_INDEX + (TOTAL_WHITE_KEYS - MIDDLE_C_WHITE_INDEX) / 2)
    / TOTAL_WHITE_KEYS
  ) * 100;

  const toggleKey = (note: string) => {
    const next = new Set(selectedKeys);
    if (next.has(note)) next.delete(note);
    else next.add(note);

    if (session?.mode === 'add' && !onPreviewKeysChange(sortPianoKeys(next))) return;
    setSelectedKeys(next);
    setIsChordMode(true);
  };

  const addSorted = (keys: Set<string>) => {
    if (keys.size === 0) return;
    const sorted = sortPianoKeys(keys);
    const octave = Number(sorted[0].split('/')[1]);
    const clef = octave >= 4 ? 'treble' : 'bass';
    if (!onAddNote(sorted, clef)) return;
    setSelectedKeys(new Set());
    setIsChordMode(false);
  };

  const updateSelected = () => {
    if (selectedKeys.size === 0 || !selectedNote || selectedNote.isRest) return;
    onUpdateSelectedKeys(sortPianoKeys(selectedKeys));
    setSelectedKeys(new Set());
    setIsChordMode(false);
    onSessionCommit();
  };

  const handleQuickAdd = (key: PianoKey) => {
    onAddNote([key.note], key.clef);
  };

  useEffect(() => {
    if (!session) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onSessionCancel();
        return;
      }
      if (event.key !== 'Enter' || selectedKeys.size === 0) return;
      event.preventDefault();
      if (session.mode === 'edit') updateSelected();
      else onSessionCommit();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div className="note-input">
      <div className="note-input-header">
        <div className="note-input-actions">
          {session && <span className="composer-target">{session.label}</span>}
          <span className="selection-hint">
            {selectedKeys.size > 0
              ? `${selectedKeys.size} note${selectedKeys.size > 1 ? 's' : ''} ${session?.mode === 'add' ? 'active in the bar' : 'selected'}${session ? ' · Press Enter to finish' : ''}`
              : isChordMode
                ? session?.mode === 'add'
                  ? 'Click piano keys to add them live. Click an active key to remove it.'
                  : 'Choose the notes that should sound together.'
                : 'Click a key to add a note. Right-click a bar to add multiple notes.'}
          </span>
          {selectedKeys.size > 0 && (
            <>
              {session?.mode === 'edit' ? (
                <button type="button" className="update-chord-btn" onClick={updateSelected}>
                  Update Selected
                </button>
              ) : !session ? (
                <button type="button" className="add-note-btn" onClick={() => addSorted(selectedKeys)}>
                  Add {selectedKeys.size > 1 ? 'Chord' : 'Note'}
                </button>
              ) : null}
              <button type="button" className="clear-btn" onClick={() => {
                setSelectedKeys(new Set());
                setIsChordMode(false);
                if (session) onSessionCancel();
              }}>
                Cancel
              </button>
            </>
          )}
          {session && selectedKeys.size === 0 && (
            <button type="button" className="clear-btn" onClick={onSessionCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="piano-keyboard">
        {/* Labels positioned above keyboard */}
        <div className="piano-clef-labels">
          <span className="clef-label bass-label" style={{ left: `${bassLabelLeft}%` }}>Bass range</span>
          <span className="clef-label treble-label" style={{ left: `${trebleLabelLeft}%` }}>Treble range</span>
        </div>
        <div className="piano-keys-area">
          <div className="piano-white-keys">
            {WHITE_KEYS.map((key) => (
              <button
                type="button"
                key={key.note}
                className={`piano-white-key ${selectedKeys.has(key.note) ? 'selected' : ''} ${playingKeys.has(key.note) ? 'playing' : ''} ${key.note.startsWith('c/') ? 'c-marker' : ''}`}
                aria-pressed={selectedKeys.has(key.note)}
                onClick={(e) => {
                  if (e.shiftKey || isChordMode || selectedKeys.size > 0) {
                    toggleKey(key.note);
                  }
                  else handleQuickAdd(key);
                }}
                title={key.label}
              >
                {(key.note.startsWith('c/') || key.midi === 21) && (
                  <span className="white-key-label">{key.label}</span>
                )}
              </button>
            ))}
          </div>
          <div className="piano-black-keys">
            {BLACK_KEYS.map((key) => {
              return (
                  <button
                    type="button"
                    key={key.note}
                  className={`piano-black-key ${selectedKeys.has(key.note) ? 'selected' : ''} ${playingKeys.has(key.note) ? 'playing' : ''}`}
                  style={{ left: `${(key.whiteBoundary / TOTAL_WHITE_KEYS) * 100}%` }}
                  aria-pressed={selectedKeys.has(key.note)}
                  onClick={(e) => {
                    if (e.shiftKey || isChordMode || selectedKeys.size > 0) {
                      toggleKey(key.note);
                    }
                    else handleQuickAdd(key);
                  }}
                  title={key.label}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
