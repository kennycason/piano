import React, { useEffect, useState } from 'react';
import {
  GENERAL_MIDI_DRUM_NAMES,
  midiToPianoKey,
  type Accidental,
  type NoteEntry,
  type TrackKind,
} from '../../models/song';
import {
  DEFAULT_SYNTH_CONTROLS,
  INSTRUMENT_OPTIONS,
  type InstrumentSound,
  type SynthControls,
} from '../../services/playback';
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
  instrumentSound: InstrumentSound;
  synthControls: SynthControls;
  onInstrumentSoundChange: (sound: InstrumentSound) => void;
  onSynthControlsChange: (controls: SynthControls) => void;
  onPreviewNotes: (keys: string[]) => void;
  showAllNoteNames: boolean;
  trackKind: TrackKind;
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
const SYNTH_CONTROL_DEFINITIONS: ReadonlyArray<{
  key: keyof SynthControls;
  label: string;
}> = [
  { key: 'volume', label: 'Volume' },
  { key: 'tone', label: 'Tone' },
  { key: 'echo', label: 'Echo' },
  { key: 'sustain', label: 'Length' },
];

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
  instrumentSound,
  synthControls,
  onInstrumentSoundChange,
  onSynthControlsChange,
  onPreviewNotes,
  showAllNoteNames,
  trackKind,
}) => {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => (
    session?.mode === 'edit' && selectedNote && !selectedNote.isRest
      ? new Set(selectedNote.drumMidi
          ? selectedNote.drumMidi.map(midiToPianoKey)
          : selectedNote.keys.map((key, index) => (
              toPianoKey(key, selectedNote.accidentals?.[index])
            )))
      : new Set()
  ));
  const [isChordMode, setIsChordMode] = useState(Boolean(session));

  const playingKeys = new Set(activePlaybackKeys);
  const isPercussion = trackKind === 'percussion';
  const availableInstruments = INSTRUMENT_OPTIONS.filter((option) => (
    isPercussion ? option.value === 'drum-kit' : option.value !== 'drum-kit'
  ));

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
        <div className="synth-panel" aria-label="Keyboard synthesizer controls">
          <span className="synth-title">Keyboard Synth</span>
          <label className="synth-preset-label">
            Preset
            <select
              className="synth-preset-select"
              value={instrumentSound}
              onChange={(event) => onInstrumentSoundChange(event.target.value as InstrumentSound)}
            >
              {availableInstruments.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {SYNTH_CONTROL_DEFINITIONS.map((control) => (
            <label className="synth-control" key={control.key}>
              <span>{control.label}</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(synthControls[control.key] * 100)}
                onChange={(event) => onSynthControlsChange({
                  ...synthControls,
                  [control.key]: Number(event.target.value) / 100,
                })}
                aria-label={`${control.label} ${Math.round(synthControls[control.key] * 100)} percent`}
              />
            </label>
          ))}
          <button
            type="button"
            className="synth-reset-btn"
            onClick={() => onSynthControlsChange({ ...DEFAULT_SYNTH_CONTROLS })}
            title="Reset sound controls"
          >
            Reset
          </button>
        </div>
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
      <div className={`piano-keyboard ${isPercussion ? 'percussion-keyboard' : ''}`}>
        <div className="piano-keys-area">
          <div className="piano-white-keys">
            {WHITE_KEYS.map((key) => (
              <button
                type="button"
                key={key.note}
                className={`piano-white-key ${selectedKeys.has(key.note) ? 'selected' : ''} ${playingKeys.has(key.note) ? 'playing' : ''} ${key.note.startsWith('c/') ? 'c-marker' : ''} ${isPercussion && !GENERAL_MIDI_DRUM_NAMES[key.midi] ? 'drum-unused' : ''}`}
                aria-pressed={selectedKeys.has(key.note)}
                disabled={isPercussion && !GENERAL_MIDI_DRUM_NAMES[key.midi]}
                aria-label={isPercussion ? GENERAL_MIDI_DRUM_NAMES[key.midi] ?? key.label : key.label}
                onPointerDown={(event) => {
                  if (event.button === 0) onPreviewNotes([key.note]);
                }}
                onClick={(e) => {
                  if (e.shiftKey || isChordMode || selectedKeys.size > 0) {
                    toggleKey(key.note);
                  }
                  else handleQuickAdd(key);
                }}
                title={isPercussion ? GENERAL_MIDI_DRUM_NAMES[key.midi] ?? key.label : key.label}
              >
                {(isPercussion ? GENERAL_MIDI_DRUM_NAMES[key.midi] : (showAllNoteNames || key.note.startsWith('c/') || key.midi === 21)) && (
                  <span className="white-key-label">
                    {isPercussion
                      ? GENERAL_MIDI_DRUM_NAMES[key.midi]
                      : showAllNoteNames ? key.label.replace(/-?\d+$/, '') : key.label}
                  </span>
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
                  className={`piano-black-key ${selectedKeys.has(key.note) ? 'selected' : ''} ${playingKeys.has(key.note) ? 'playing' : ''} ${isPercussion && !GENERAL_MIDI_DRUM_NAMES[key.midi] ? 'drum-unused' : ''}`}
                  style={{ left: `${(key.whiteBoundary / TOTAL_WHITE_KEYS) * 100}%` }}
                  aria-pressed={selectedKeys.has(key.note)}
                  disabled={isPercussion && !GENERAL_MIDI_DRUM_NAMES[key.midi]}
                  aria-label={isPercussion ? GENERAL_MIDI_DRUM_NAMES[key.midi] ?? key.label : key.label}
                  onPointerDown={(event) => {
                    if (event.button === 0) onPreviewNotes([key.note]);
                  }}
                  onClick={(e) => {
                    if (e.shiftKey || isChordMode || selectedKeys.size > 0) {
                      toggleKey(key.note);
                    }
                    else handleQuickAdd(key);
                  }}
                  title={isPercussion ? GENERAL_MIDI_DRUM_NAMES[key.midi] ?? key.label : key.label}
                >
                  {(isPercussion ? GENERAL_MIDI_DRUM_NAMES[key.midi] : showAllNoteNames) && (
                    <span className="black-key-label">
                      {isPercussion
                        ? GENERAL_MIDI_DRUM_NAMES[key.midi]
                        : key.label.replace(/-?\d+$/, '').replace('#', '♯')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
