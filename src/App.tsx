import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Toolbar } from './components/Toolbar/Toolbar';
import { PlaybackBar } from './components/PlaybackBar/PlaybackBar';
import { SongManager } from './components/SongManager/SongManager';
import { NoteInput } from './components/ScoreEditor/NoteInput';
import type {
  Song,
  EditableScore,
  NoteEntry,
  NoteDuration,
  Accidental,
  Dynamic,
  Articulation,
  StaffClef,
  Measure,
} from './models/song';
import {
  GENERAL_MIDI_DRUM_NAMES,
  createDefaultSong,
  createDefaultMeasure,
  createEditableScore,
  createId,
  drumMidiToStaffKey,
  getMeasureBeatCount,
  getMeasureCapacity,
  getNoteBeatValue,
  getMeasureVoice,
  getMeasureVoices,
  replaceMeasureVoice,
  mapMeasureNotes,
  getMeasureNoteIds,
  getKeySignatureAccidental,
  notesHaveSamePitches,
  pianoKeyToMidi,
  replaceSongTrackFromScore,
} from './models/song';
import {
  loadSongs,
  initializeSongLibrary,
  saveSong,
  deleteSong as deleteStoredSong,
  setCurrentSongId,
  getCurrentSongId,
  exportSongToJson,
  importSongFromJson,
  DEFAULT_STARTER_SONG_ID,
} from './services/storage';
import {
  getPlaybackCursorX,
  renderSong,
  type NoteNameMode,
  type RenderResult,
} from './services/renderer';
import {
  playbackEngine,
  type InstrumentSound,
  type SynthControls,
} from './services/playback';
import { importSongFromMidi } from './services/midi';
import './App.css';

const MAX_HISTORY = 50;
const PITCH_NAMES = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const NOTE_NAMES_STORAGE_KEY = 'piano_sheet_show_note_names';
type PlayState = 'stopped' | 'loading' | 'playing' | 'paused';
type SaveStatus = 'saved' | 'saving' | 'error';
interface NoteLocation {
  measureIdx: number;
  noteIdx: number;
  clef: StaffClef;
  voiceIdx: number;
}

interface ScoreTarget {
  measureIdx: number;
  clef: StaffClef;
  voiceIdx: number;
}

type ScoreContextMenu =
  | { kind: 'measure'; x: number; y: number; target: ScoreTarget }
  | { kind: 'note'; x: number; y: number; noteId: string; location: NoteLocation };

interface ComposerRequest {
  id: number;
  mode: 'add' | 'edit';
  target?: ScoreTarget;
}

type EditorClipboard =
  | { kind: 'note'; note: NoteEntry; source: ScoreTarget }
  | { kind: 'measure'; measure: Measure };

function copyNoteData(note: NoteEntry): NoteEntry {
  return {
    ...note,
    keys: [...note.keys],
    drumMidi: note.drumMidi ? [...note.drumMidi] : undefined,
    accidentals: note.accidentals ? [...note.accidentals] : undefined,
    articulations: note.articulations ? [...note.articulations] : undefined,
  };
}

function cloneNoteForPaste(note: NoteEntry): NoteEntry {
  return {
    ...copyNoteData(note),
    id: createId(),
    tieToNext: undefined,
    slurToNoteId: undefined,
    slurPlacement: undefined,
    slurStart: undefined,
    slurEnd: undefined,
  };
}

function cloneMeasureForPaste(measure: Measure): Measure {
  const oldIds = getMeasureNoteIds(measure);
  const idMap = new Map(oldIds.map((id) => [id, createId()]));
  const cloneVoice = (voice: NoteEntry[]) => voice.map((note, index) => ({
    ...copyNoteData(note),
    id: idMap.get(note.id) ?? createId(),
    tieToNext: note.tieToNext && index < voice.length - 1 ? true : undefined,
    slurToNoteId: note.slurToNoteId ? idMap.get(note.slurToNoteId) : undefined,
    slurPlacement: note.slurToNoteId && idMap.has(note.slurToNoteId)
      ? note.slurPlacement
      : undefined,
  }));
  return {
    ...measure,
    treble: cloneVoice(measure.treble),
    bass: cloneVoice(measure.bass),
    additionalTrebleVoices: measure.additionalTrebleVoices?.map(cloneVoice),
    additionalBassVoices: measure.additionalBassVoices?.map(cloneVoice),
  };
}

function transposeNoteBySteps(note: NoteEntry, steps: number): NoteEntry {
  if (note.drumMidi) return note;
  if (note.isRest) {
    const restOffset = Math.max(-6, Math.min(6, (note.restOffset ?? 0) + steps * 0.5));
    return { ...note, restOffset: restOffset || undefined };
  }
  return {
    ...note,
    keys: note.keys.map((key) => {
      const [name, octaveText] = key.split('/');
      const pitchIndex = PITCH_NAMES.indexOf(name[0]?.toLowerCase());
      if (pitchIndex < 0) return key;
      const absolutePitch = Number(octaveText) * PITCH_NAMES.length + pitchIndex + steps;
      const octave = Math.floor(absolutePitch / PITCH_NAMES.length);
      const normalizedPitchIndex = ((absolutePitch % PITCH_NAMES.length) + PITCH_NAMES.length)
        % PITCH_NAMES.length;
      return `${PITCH_NAMES[normalizedPitchIndex]}${name.slice(1)}/${octave}`;
    }),
  };
}

function staffYToKey(y: number, staffTopY: number, displayClef: StaffClef): string {
  const topLinePitch = displayClef === 'treble'
    ? 5 * PITCH_NAMES.length + PITCH_NAMES.indexOf('f')
    : 3 * PITCH_NAMES.length + PITCH_NAMES.indexOf('a');
  const diatonicStepsDown = Math.round((y - staffTopY) / 5);
  const absolutePitch = topLinePitch - diatonicStepsDown;
  const octave = Math.floor(absolutePitch / PITCH_NAMES.length);
  const pitchIndex = ((absolutePitch % PITCH_NAMES.length) + PITCH_NAMES.length)
    % PITCH_NAMES.length;
  return `${PITCH_NAMES[pitchIndex]}/${octave}`;
}

function normalizePianoKeys(keys: string[], keySignature: string): {
  keys: string[];
  accidentals?: (Accidental | null)[];
} {
  const normalizedKeys = keys.map((key) => {
    const [name, octave] = key.split('/');
    return `${name[0]}/${octave}`;
  });
  const accidentals = keys.map((key): Accidental | null => {
    const name = key.split('/')[0];
    if (name.includes('#')) return '#';
    if (name.includes('b')) return 'b';
    if (getKeySignatureAccidental(keySignature, name)) return 'n';
    return null;
  });
  return {
    keys: normalizedKeys,
    accidentals: accidentals.some(Boolean) ? accidentals : undefined,
  };
}

function createInitialLibrary(): { songs: Song[]; currentSong: Song } {
  const savedSongs = initializeSongLibrary();
  const savedId = getCurrentSongId();
  const currentSong = savedSongs.find((song) => song.id === savedId)
    ?? savedSongs.find((song) => song.id === DEFAULT_STARTER_SONG_ID)
    ?? savedSongs[0];
  if (currentSong) return { songs: savedSongs, currentSong };

  const newSong = createDefaultSong();
  return { songs: [newSong], currentSong: newSong };
}

function getInitialNoteNameMode(): NoteNameMode {
  try {
    const saved = localStorage.getItem(NOTE_NAMES_STORAGE_KEY);
    if (saved === 'inside' || saved === 'below') return saved;
    return saved === 'true' ? 'inside' : 'off';
  } catch {
    return 'off';
  }
}

function App() {
  const [initialLibrary] = useState(createInitialLibrary);
  const [songs, setSongs] = useState<Song[]>(initialLibrary.songs);
  const [currentSong, setCurrentSong] = useState<Song>(initialLibrary.currentSong);
  const [activeTrackId, setActiveTrackId] = useState(initialLibrary.currentSong.tracks[0].id);
  const activeScore = useMemo(
    () => createEditableScore(currentSong, activeTrackId),
    [currentSong, activeTrackId],
  );
  const instrumentSound = activeScore.instrumentSound;
  const synthControls = activeScore.synthControls;

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [chordToneSelection, setChordToneSelection] = useState({ noteId: null as string | null, index: 0 });
  const [selectedDuration, setSelectedDuration] = useState<NoteDuration>('q');
  const [isRestMode, setIsRestMode] = useState(false);
  const [isDotted, setIsDotted] = useState(false);
  const [playState, setPlayState] = useState<PlayState>('stopped');
  const [soloActiveTrack, setSoloActiveTrack] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [noteNameMode, setNoteNameMode] = useState<NoteNameMode>(getInitialNoteNameMode);
  const [currentPlayMeasure, setCurrentPlayMeasure] = useState(0);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);
  const [slurToolActive, setSlurToolActive] = useState(false);
  const [pendingSlurStartId, setPendingSlurStartId] = useState<string | null>(null);
  const [selectedBarTarget, setSelectedBarTarget] = useState<ScoreTarget | null>(null);
  const [scoreContextMenu, setScoreContextMenu] = useState<ScoreContextMenu | null>(null);
  const [composerRequest, setComposerRequest] = useState<ComposerRequest | null>(null);
  const [isDraggingNote, setIsDraggingNote] = useState(false);
  const [highlightedNoteIds, setHighlightedNoteIds] = useState<string[]>([]);
  const [activePlaybackKeys, setActivePlaybackKeys] = useState<string[]>([]);
  const [editorClipboard, setEditorClipboard] = useState<EditorClipboard | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [pendingDeleteSongId, setPendingDeleteSongId] = useState<string | null>(null);
  const [deletedSongUndo, setDeletedSongUndo] = useState<{ song: Song; wasCurrent: boolean } | null>(null);

  // Undo/redo history
  const [undoStack, setUndoStack] = useState<Song[]>([]);
  const [redoStack, setRedoStack] = useState<Song[]>([]);

  const selectedChordToneIndex = chordToneSelection.noteId === selectedNoteId
    ? chordToneSelection.index
    : 0;
  const setSelectedChordToneIndex = useCallback((index: number) => {
    setChordToneSelection({ noteId: selectedNoteId, index });
  }, [selectedNoteId]);

  const scoreRef = useRef<HTMLDivElement>(null);
  const currentSongRef = useRef(currentSong);
  const currentScoreRef = useRef<EditableScore>(activeScore);
  const noteMapRef = useRef<RenderResult['noteElements']>(new Map());
  const measureRegionsRef = useRef<RenderResult['measureRegions']>([]);
  const dragRef = useRef<{ noteId: string; startY: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const composerRequestIdRef = useRef(0);
  const composerBaseSongRef = useRef<Song | null>(null);
  const provisionalNoteIdRef = useRef<string | null>(null);
  const playbackAnimationRef = useRef<number | null>(null);
  const highlightedNoteIdsRef = useRef<string[]>([]);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const stopPlaybackForEdit = useCallback(() => {
    if (playbackEngine.getState() === 'stopped') return;
    playbackEngine.stop();
    setPlayState('stopped');
    setHighlightedNoteIds([]);
    setActivePlaybackKeys([]);
    setCurrentPlayMeasure(0);
  }, []);

  useEffect(() => {
    currentSongRef.current = currentSong;
    currentScoreRef.current = activeScore;
  }, [currentSong, activeScore]);

  useEffect(() => {
    highlightedNoteIdsRef.current = highlightedNoteIds;
    const activeIds = new Set(highlightedNoteIds);
    scoreRef.current?.querySelectorAll<SVGGElement>('[data-note-id]').forEach((element) => {
      element.classList.toggle(
        'playback-active-note',
        activeIds.has(element.getAttribute('data-note-id') ?? ''),
      );
    });
  }, [highlightedNoteIds]);

  useEffect(() => {
    let active = true;
    try {
      saveSong(initialLibrary.currentSong);
      setCurrentSongId(initialLibrary.currentSong.id);
    } catch (error) {
      queueMicrotask(() => {
        if (!active) return;
        setSaveStatus('error');
        setEditorMessage(error instanceof Error ? error.message : 'This browser could not save locally.');
      });
    }
    return () => { active = false; };
  }, [initialLibrary]);

  const findNoteLocation = useCallback(
    (noteId: string): NoteLocation | null => {
      for (let mi = 0; mi < activeScore.measures.length; mi++) {
        const m = activeScore.measures[mi];
        for (const clef of ['treble', 'bass'] as const) {
          const voices = getMeasureVoices(m, clef);
          for (let voiceIdx = 0; voiceIdx < voices.length; voiceIdx++) {
            const ni = voices[voiceIdx].findIndex((note) => note.id === noteId);
            if (ni >= 0) return { measureIdx: mi, noteIdx: ni, clef, voiceIdx };
          }
        }
      }
      return null;
    },
    [activeScore]
  );

  const findNextNoteLocation = useCallback((location: NoteLocation): NoteLocation | null => {
    const currentVoice = getMeasureVoice(
      activeScore.measures[location.measureIdx],
      location.clef,
      location.voiceIdx,
    );
    if (currentVoice[location.noteIdx + 1]) {
      return { ...location, noteIdx: location.noteIdx + 1 };
    }
    for (let measureIdx = location.measureIdx + 1; measureIdx < activeScore.measures.length; measureIdx++) {
      const voice = getMeasureVoice(activeScore.measures[measureIdx], location.clef, location.voiceIdx);
      if (voice.length > 0) {
        return { measureIdx, noteIdx: 0, clef: location.clef, voiceIdx: location.voiceIdx };
      }
    }
    return null;
  }, [activeScore]);

  const getSelectedNote = useCallback((): NoteEntry | null => {
    if (!selectedNoteId) return null;
    const loc = findNoteLocation(selectedNoteId);
    if (!loc) return null;
    const notes = getMeasureVoice(
      activeScore.measures[loc.measureIdx],
      loc.clef,
      loc.voiceIdx,
    );
    return notes[loc.noteIdx];
  }, [selectedNoteId, findNoteLocation, activeScore]);

  const updateSong = useCallback(
    (updater: (song: EditableScore) => EditableScore) => {
      const nextScore = updater(activeScore);
      if (nextScore === activeScore) return;

      const updatedSong = {
        ...replaceSongTrackFromScore(currentSong, nextScore),
        updatedAt: Date.now(),
      };
      stopPlaybackForEdit();
      setSaveStatus('saving');
      try {
        saveSong(updatedSong);
      } catch (error) {
        setSaveStatus('error');
        setEditorMessage(error instanceof Error ? error.message : 'This browser could not save locally.');
        return;
      }
      setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), currentSong]);
      setRedoStack([]);
      setCurrentSong(updatedSong);
      setSongs(loadSongs());
      setSaveStatus('saved');
    },
    [activeScore, currentSong, stopPlaybackForEdit]
  );

  const updateProject = useCallback((updater: (song: Song) => Song) => {
    const next = updater(currentSong);
    if (next === currentSong) return;
    const updatedSong = { ...next, updatedAt: Date.now() };
    stopPlaybackForEdit();
    setSaveStatus('saving');
    try {
      saveSong(updatedSong);
    } catch (error) {
      setSaveStatus('error');
      setEditorMessage(error instanceof Error ? error.message : 'This browser could not save locally.');
      return;
    }
    setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), currentSong]);
    setRedoStack([]);
    setCurrentSong(updatedSong);
    setSongs(loadSongs());
    setSaveStatus('saved');
  }, [currentSong, stopPlaybackForEdit]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    stopPlaybackForEdit();
    const previousSong = { ...undoStack[undoStack.length - 1], updatedAt: Date.now() };
    setSaveStatus('saving');
    try {
      saveSong(previousSong);
    } catch (error) {
      setSaveStatus('error');
      setEditorMessage(error instanceof Error ? error.message : 'This browser could not save locally.');
      return;
    }
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), currentSong]);
    setCurrentSong(previousSong);
    setSongs(loadSongs());
    setSaveStatus('saved');
  }, [currentSong, undoStack, stopPlaybackForEdit]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    stopPlaybackForEdit();
    const nextSong = { ...redoStack[redoStack.length - 1], updatedAt: Date.now() };
    setSaveStatus('saving');
    try {
      saveSong(nextSong);
    } catch (error) {
      setSaveStatus('error');
      setEditorMessage(error instanceof Error ? error.message : 'This browser could not save locally.');
      return;
    }
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), currentSong]);
    setCurrentSong(nextSong);
    setSongs(loadSongs());
    setSaveStatus('saved');
  }, [currentSong, redoStack, stopPlaybackForEdit]);

  const modifySelectedNote = useCallback(
    (modifier: (note: NoteEntry) => NoteEntry) => {
      if (!selectedNoteId) return;
      const loc = findNoteLocation(selectedNoteId);
      if (!loc) return;
      const notes = getMeasureVoice(
        activeScore.measures[loc.measureIdx],
        loc.clef,
        loc.voiceIdx,
      );
      const modified = modifier({ ...notes[loc.noteIdx] });
      const otherBeats = notes.reduce(
        (sum, note, index) => index === loc.noteIdx ? sum : sum + getNoteBeatValue(note),
        0,
      );
      const capacity = getMeasureCapacity(currentSong.timeSignature);
      if (otherBeats + getNoteBeatValue(modified) > capacity) {
        setEditorMessage(`That duration will not fit in bar ${loc.measureIdx + 1}.`);
        return;
      }

      updateSong((song) => {
        const newSong = { ...song, measures: song.measures.map((m) => ({ ...m })) };
        const updatedNotes = [...getMeasureVoice(
          newSong.measures[loc.measureIdx],
          loc.clef,
          loc.voiceIdx,
        )];
        updatedNotes[loc.noteIdx] = modified;
        newSong.measures[loc.measureIdx] = replaceMeasureVoice(
          newSong.measures[loc.measureIdx],
          loc.clef,
          loc.voiceIdx,
          updatedNotes,
        );
        return newSong;
      });
      setEditorMessage(null);
    },
    [selectedNoteId, findNoteLocation, activeScore, currentSong.timeSignature, updateSong]
  );

  // Render score
  useEffect(() => {
    const container = scoreRef.current;
    if (!container) return;
    let animationFrame = 0;

    const drawScore = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const result = renderSong(
          container,
          activeScore,
          selectedNoteId,
          null,
          container.clientWidth - 40,
          selectedBarTarget,
          noteNameMode,
        );
        noteMapRef.current = result.noteElements;
        measureRegionsRef.current = result.measureRegions;
        const activeIds = new Set(highlightedNoteIdsRef.current);
        container.querySelectorAll<SVGGElement>('[data-note-id]').forEach((element) => {
          element.classList.toggle(
            'playback-active-note',
            activeIds.has(element.getAttribute('data-note-id') ?? ''),
          );
        });
      });
    };

    drawScore();
    const resizeObserver = new ResizeObserver(drawScore);
    resizeObserver.observe(container);
    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [activeScore, selectedNoteId, selectedBarTarget, noteNameMode]);

  const clearPlaybackCursor = useCallback(() => {
    scoreRef.current
      ?.querySelector('.playback-cursor-line')
      ?.remove();
  }, []);

  const drawPlaybackCursor = useCallback((measureIdx: number, progress: number) => {
    const container = scoreRef.current;
    const svg = container?.querySelector('svg');
    const regions = measureRegionsRef.current.filter((region) => region.measureIdx === measureIdx);
    if (!container || !svg || regions.length === 0) return;

    const referenceRegion = regions[0];
    const x = getPlaybackCursorX(referenceRegion.playbackAnchors, progress)
      ?? referenceRegion.x + Math.max(0, Math.min(1, progress)) * referenceRegion.width;
    const y1 = Math.min(...regions.map((region) => region.y)) - 9;
    const y2 = Math.max(...regions.map((region) => region.y + region.height)) + 9;
    let line = svg.querySelector<SVGLineElement>('.playback-cursor-line');
    if (!line) {
      line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'playback-cursor-line');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(line);
    }
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
    line.setAttribute('y1', String(y1));
    line.setAttribute('y2', String(y2));
  }, []);

  useEffect(() => {
    if (playbackAnimationRef.current !== null) {
      cancelAnimationFrame(playbackAnimationRef.current);
      playbackAnimationRef.current = null;
    }
    if (playState === 'stopped' || playState === 'loading') {
      clearPlaybackCursor();
      return;
    }

    const tick = () => {
      const cursor = playbackEngine.getCursorState();
      if (cursor) {
        drawPlaybackCursor(cursor.measureIdx, cursor.progress);
        setCurrentPlayMeasure((measureIdx) => (
          measureIdx === cursor.measureIdx ? measureIdx : cursor.measureIdx
        ));
      }
      if (playState === 'playing') {
        playbackAnimationRef.current = requestAnimationFrame(tick);
      }
    };
    playbackAnimationRef.current = requestAnimationFrame(tick);
    return () => {
      if (playbackAnimationRef.current !== null) {
        cancelAnimationFrame(playbackAnimationRef.current);
        playbackAnimationRef.current = null;
      }
    };
  }, [activeTrackId, playState, clearPlaybackCursor, drawPlaybackCursor]);

  useEffect(() => {
    if (playState !== 'playing' && playState !== 'paused') return;
    const container = scoreRef.current;
    const region = measureRegionsRef.current.find((candidate) => (
      candidate.measureIdx === currentPlayMeasure
    ));
    if (!container || !region) return;
    const targetTop = Math.max(0, region.y - container.clientHeight * 0.3);
    const visibleTop = container.scrollTop;
    const visibleBottom = visibleTop + container.clientHeight;
    if (region.y < visibleTop + 24 || region.y + region.height > visibleBottom - 24) {
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }, [currentPlayMeasure, playState]);

  useEffect(() => {
    if (!selectedBarTarget) return;
    const animationFrame = requestAnimationFrame(() => {
      const container = scoreRef.current;
      const region = measureRegionsRef.current.find((candidate) => (
        candidate.measureIdx === selectedBarTarget.measureIdx &&
        candidate.clef === selectedBarTarget.clef
      ));
      if (!container || !region) return;
      const regionTop = region.y + 20;
      const regionBottom = regionTop + region.height;
      const visibleTop = container.scrollTop;
      const visibleBottom = visibleTop + container.clientHeight;
      if (regionTop < visibleTop || regionBottom > visibleBottom) {
        container.scrollTo({
          top: Math.max(0, regionTop - container.clientHeight / 2),
          behavior: 'smooth',
        });
      }
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [activeScore.measures.length, selectedBarTarget]);

  const handleNoteSelection = useCallback((noteId: string) => {
    if (!slurToolActive) {
      setSelectedNoteId(noteId);
      setSelectedBarTarget(null);
      setComposerRequest(null);
      setEditorMessage(null);
      return;
    }

    const clickedLocation = findNoteLocation(noteId);
    if (!clickedLocation) return;
    const clickedNote = getMeasureVoice(
      activeScore.measures[clickedLocation.measureIdx],
      clickedLocation.clef,
      clickedLocation.voiceIdx,
    )[clickedLocation.noteIdx];
    if (clickedNote.isRest) {
      setEditorMessage('A slur can only connect notes, not rests.');
      return;
    }

    if (!pendingSlurStartId) {
      setPendingSlurStartId(noteId);
      setSelectedNoteId(noteId);
      setEditorMessage('Slur: now select the ending note.');
      return;
    }

    if (pendingSlurStartId === noteId) {
      setEditorMessage('Choose a different note for the end of the slur.');
      return;
    }

    const pendingLocation = findNoteLocation(pendingSlurStartId);
    if (!pendingLocation) {
      setPendingSlurStartId(noteId);
      setSelectedNoteId(noteId);
      setEditorMessage('The starting note changed. Now select the ending note.');
      return;
    }
    if (
      pendingLocation.clef !== clickedLocation.clef ||
      pendingLocation.voiceIdx !== clickedLocation.voiceIdx
    ) {
      setEditorMessage('Choose an ending note in the same staff voice.');
      return;
    }

    const pendingOrder = pendingLocation.measureIdx * 10_000 + pendingLocation.noteIdx;
    const clickedOrder = clickedLocation.measureIdx * 10_000 + clickedLocation.noteIdx;
    const startId = pendingOrder < clickedOrder ? pendingSlurStartId : noteId;
    const endId = pendingOrder < clickedOrder ? noteId : pendingSlurStartId;
    const startLocation = pendingOrder < clickedOrder ? pendingLocation : clickedLocation;
    const startNote = getMeasureVoice(
      activeScore.measures[startLocation.measureIdx],
      startLocation.clef,
      startLocation.voiceIdx,
    )[startLocation.noteIdx];
    const shouldRemove = startNote.slurToNoteId === endId;
    const defaultSlurPlacement = startLocation.voiceIdx > 0
      ? 'below'
      : startLocation.clef === 'treble' || activeScore.staffLayout === 'bass-only'
        ? 'above'
        : 'below';

    updateSong((song) => ({
      ...song,
      measures: song.measures.map((measure) => mapMeasureNotes(measure, (note) => (
          note.id === startId
            ? {
                ...note,
                slurToNoteId: shouldRemove ? undefined : endId,
                slurPlacement: shouldRemove
                  ? undefined
                  : note.slurPlacement ?? defaultSlurPlacement,
                slurStart: undefined,
              }
            : note.id === endId ? { ...note, slurEnd: undefined } : note
        ))),
    }));
    setSelectedNoteId(endId);
    setSlurToolActive(false);
    setPendingSlurStartId(null);
    setEditorMessage(null);
  }, [slurToolActive, pendingSlurStartId, findNoteLocation, activeScore, updateSong]);

  const getScorePoint = useCallback((clientX: number, clientY: number) => {
    const container = scoreRef.current;
    const svg = container?.querySelector('svg');
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const renderedWidth = svg.width.baseVal.value || rect.width;
    const renderedHeight = svg.height.baseVal.value || rect.height;
    return {
      x: (clientX - rect.left) * (renderedWidth / rect.width),
      y: (clientY - rect.top) * (renderedHeight / rect.height),
    };
  }, []);

  const getScoreTargetAtPoint = useCallback((x: number, y: number): ScoreTarget | null => {
    const region = measureRegionsRef.current.find((candidate) => (
      x >= candidate.x && x <= candidate.x + candidate.width &&
      y >= candidate.y && y <= candidate.y + candidate.height
    ));
    if (!region) return null;
    const voices = getMeasureVoices(activeScore.measures[region.measureIdx], region.clef);
    const voiceIdx = voices.length > 1 && y > region.voiceSplitY ? 1 : 0;
    return { measureIdx: region.measureIdx, clef: region.clef, voiceIdx };
  }, [activeScore]);

  // Blank score space selects a bar. Clicking vertically above or below the
  // selected notehead adds a natural pitch to that chord.
  const handleScoreClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      if (composerRequest) {
        setEditorMessage('Finish note entry with Enter, or use Cancel before editing the score.');
        return;
      }
      setScoreContextMenu(null);
      const directNoteId = (e.target as Element).closest?.('[data-note-id]')?.getAttribute('data-note-id');
      if (directNoteId) {
        handleNoteSelection(directNoteId);
        return;
      }
      const point = getScorePoint(e.clientX, e.clientY);
      if (!point) return;

      if (!slurToolActive && selectedNoteId) {
        const selectedInfo = noteMapRef.current.get(selectedNoteId);
        const selected = getSelectedNote();
        if (
          selectedInfo && selected && !selected.isRest && !selected.drumMidi &&
          Math.abs(point.x - selectedInfo.x) <= 14 &&
          Math.abs(point.y - selectedInfo.y) >= 7 &&
          Math.abs(point.y - selectedInfo.y) <= 60
        ) {
          const region = measureRegionsRef.current.find((candidate) => (
            candidate.measureIdx === selectedInfo.measureIdx && candidate.clef === selectedInfo.clef
          ));
          if (region) {
            const displayClef = activeScore.staffClefs?.[selectedInfo.clef] ?? selectedInfo.clef;
            const key = staffYToKey(
              point.y,
              region.voiceSplitY - 20,
              displayClef === 'bass' ? 'bass' : 'treble',
            );
            if (!selected.keys.includes(key)) {
              modifySelectedNote((note) => {
                const entries = note.keys.map((existingKey, index) => ({
                  key: existingKey,
                  accidental: note.accidentals?.[index] ?? null,
                }));
                entries.push({ key, accidental: null });
                entries.sort((a, b) => {
                  const [aName, aOctave] = a.key.split('/');
                  const [bName, bOctave] = b.key.split('/');
                  return Number(aOctave) * 7 + PITCH_NAMES.indexOf(aName[0])
                    - (Number(bOctave) * 7 + PITCH_NAMES.indexOf(bName[0]));
                });
                const accidentals = entries.map((entry) => entry.accidental);
                return {
                  ...note,
                  keys: entries.map((entry) => entry.key),
                  accidentals: accidentals.some(Boolean) ? accidentals : undefined,
                };
              });
              setEditorMessage(`Added ${key} to the selected chord.`);
            }
            return;
          }
        }
      }

      let closestId: string | null = null;
      let closestDist = Infinity;
      noteMapRef.current.forEach((info, id) => {
        const dist = Math.sqrt((point.x - info.x) ** 2 + (point.y - info.y) ** 2);
        if (dist < closestDist && dist < 18) {
          closestDist = dist;
          closestId = id;
        }
      });
      if (closestId) {
        handleNoteSelection(closestId);
        return;
      }
      if (!slurToolActive) {
        const target = getScoreTargetAtPoint(point.x, point.y);
        setSelectedNoteId(null);
        setComposerRequest(null);
        setSelectedBarTarget(target);
        if (target) {
          const voiceLabel = activeScore.voiceLabels?.[target.clef]?.[target.voiceIdx]
            ?? (target.voiceIdx === 0 ? 'upper voice' : 'lower voice');
          setEditorMessage(`Bar ${target.measureIdx + 1}, ${voiceLabel} selected. Click a piano key, or right-click the bar for Add note(s).`);
        } else {
          setEditorMessage(null);
        }
      }
    },
    [
      composerRequest,
      activeScore,
      getScorePoint,
      getScoreTargetAtPoint,
      getSelectedNote,
      handleNoteSelection,
      modifySelectedNote,
      selectedNoteId,
      slurToolActive,
    ]
  );

  const handleScoreContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (composerRequest) {
      setEditorMessage('Finish note entry with Enter, or use Cancel before editing the score.');
      return;
    }
    const x = Math.min(e.clientX, window.innerWidth - 230);
    const y = Math.min(e.clientY, window.innerHeight - 190);
    const directNoteId = (e.target as Element).closest?.('[data-note-id]')?.getAttribute('data-note-id');
    if (directNoteId) {
      const location = findNoteLocation(directNoteId);
      if (!location) return;
      setSelectedNoteId(directNoteId);
      setSelectedBarTarget(null);
      setComposerRequest(null);
      setScoreContextMenu({ kind: 'note', x, y, noteId: directNoteId, location });
      setEditorMessage(null);
      return;
    }
    const point = getScorePoint(e.clientX, e.clientY);
    if (!point) return;
    const target = getScoreTargetAtPoint(point.x, point.y);
    if (!target) {
      setScoreContextMenu(null);
      return;
    }
    setSelectedNoteId(null);
    setSelectedBarTarget(target);
    setComposerRequest(null);
    setScoreContextMenu({ kind: 'measure', x, y, target });
  }, [composerRequest, findNoteLocation, getScorePoint, getScoreTargetAtPoint]);

  const beginAddingNotes = useCallback((target: ScoreTarget) => {
    composerBaseSongRef.current = currentSongRef.current;
    provisionalNoteIdRef.current = null;
    setSelectedNoteId(null);
    setSelectedBarTarget(target);
    setScoreContextMenu(null);
    setIsRestMode(false);
    setComposerRequest({ id: ++composerRequestIdRef.current, mode: 'add', target });
    const voiceLabel = activeScore.voiceLabels?.[target.clef]?.[target.voiceIdx]
      ?? (target.voiceIdx === 0 ? 'upper voice' : 'lower voice');
    setEditorMessage(`Adding to bar ${target.measureIdx + 1}, ${voiceLabel}: piano keys update the bar live. Press Enter to finish or Cancel to restore it.`);
  }, [activeScore]);

  const addLowerVoice = useCallback((target: ScoreTarget) => {
    const lowerVoiceTarget = { ...target, voiceIdx: 1 };
    updateSong((song) => {
      const measures = song.measures.map((measure) => ({ ...measure }));
      measures[target.measureIdx] = replaceMeasureVoice(
        measures[target.measureIdx],
        target.clef,
        1,
        getMeasureVoice(measures[target.measureIdx], target.clef, 1),
      );
      return { ...song, measures };
    });
    setSelectedNoteId(null);
    setSelectedBarTarget(lowerVoiceTarget);
    setScoreContextMenu(null);
    setEditorMessage(`Lower voice created in bar ${target.measureIdx + 1}. Piano input will be added there.`);
  }, [updateSong]);

  const beginEditingNote = useCallback((noteId: string) => {
    composerBaseSongRef.current = null;
    provisionalNoteIdRef.current = null;
    setSelectedNoteId(noteId);
    setSelectedBarTarget(null);
    setScoreContextMenu(null);
    setComposerRequest({ id: ++composerRequestIdRef.current, mode: 'edit' });
    setEditorMessage('Edit the selected note or chord with the piano, then press Enter.');
  }, []);

  const previewComposerKeys = useCallback((keys: string[]): boolean => {
    if (composerRequest?.mode !== 'add' || !composerRequest.target) return false;
    const target = composerRequest.target;
    const project = currentSongRef.current;
    const song = currentScoreRef.current;
    const measure = song.measures[target.measureIdx];
    if (!measure) return false;

    const notes = [...getMeasureVoice(measure, target.clef, target.voiceIdx)];
    const provisionalId = provisionalNoteIdRef.current;
    const provisionalIndex = provisionalId
      ? notes.findIndex((note) => note.id === provisionalId)
      : -1;

    if (keys.length === 0) {
      if (provisionalIndex >= 0) notes.splice(provisionalIndex, 1);
      const measures = song.measures.map((candidate) => ({ ...candidate }));
      measures[target.measureIdx] = replaceMeasureVoice(
        measures[target.measureIdx],
        target.clef,
        target.voiceIdx,
        notes,
      );
      const previewScore = { ...song, measures };
      const previewSong = replaceSongTrackFromScore(project, previewScore);
      currentScoreRef.current = previewScore;
      currentSongRef.current = previewSong;
      setCurrentSong(previewSong);
      setSelectedNoteId(null);
      return true;
    }

    const normalized = normalizePianoKeys(keys, song.keySignature);
    const drumMidi = song.kind === 'percussion' ? keys.map(pianoKeyToMidi) : undefined;
    const noteId = provisionalId ?? createId();
    const existing = provisionalIndex >= 0 ? notes[provisionalIndex] : null;
    const provisionalNote: NoteEntry = {
      ...(existing ?? { id: noteId, duration: selectedDuration }),
      keys: drumMidi?.map(drumMidiToStaffKey) ?? normalized.keys,
      accidentals: drumMidi ? undefined : normalized.accidentals,
      drumMidi,
      isRest: undefined,
      dotted: isDotted || undefined,
      suppressAccidentals: undefined,
    };
    const otherNotes = provisionalIndex >= 0
      ? notes.filter((_, index) => index !== provisionalIndex)
      : notes;
    const capacity = getMeasureCapacity(song.timeSignature);
    if (getMeasureBeatCount(otherNotes) + getNoteBeatValue(provisionalNote) > capacity) {
      setEditorMessage(`Bar ${target.measureIdx + 1} does not have room for that chord.`);
      return false;
    }

    if (provisionalIndex >= 0) notes[provisionalIndex] = provisionalNote;
    else notes.push(provisionalNote);
    const measures = song.measures.map((candidate) => ({ ...candidate }));
    measures[target.measureIdx] = replaceMeasureVoice(
      measures[target.measureIdx],
      target.clef,
      target.voiceIdx,
      notes,
    );
    const previewScore = { ...song, measures };
    const previewSong = replaceSongTrackFromScore(project, previewScore);
    provisionalNoteIdRef.current = noteId;
    currentScoreRef.current = previewScore;
    currentSongRef.current = previewSong;
    setCurrentSong(previewSong);
    setSelectedNoteId(noteId);
    setEditorMessage(`Building in bar ${target.measureIdx + 1}: click keys to toggle pitches, then press Enter to finish.`);
    return true;
  }, [composerRequest, isDotted, selectedDuration]);

  const commitComposerSession = useCallback(() => {
    if (composerRequest?.mode === 'add') {
      const baseSong = composerBaseSongRef.current;
      const provisionalId = provisionalNoteIdRef.current;
      if (!baseSong || !provisionalId) return;
      const committedSong = { ...currentSongRef.current, updatedAt: Date.now() };
      setSaveStatus('saving');
      try {
        saveSong(committedSong);
      } catch (error) {
        setSaveStatus('error');
        setEditorMessage(error instanceof Error ? error.message : 'This browser could not save locally.');
        return;
      }
      setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), baseSong]);
      setRedoStack([]);
      currentSongRef.current = committedSong;
      setCurrentSong(committedSong);
      setSongs(loadSongs());
      setSaveStatus('saved');
    }
    composerBaseSongRef.current = null;
    provisionalNoteIdRef.current = null;
    setComposerRequest(null);
    setEditorMessage(null);
  }, [composerRequest]);

  const cancelComposerSession = useCallback(() => {
    if (composerRequest?.mode === 'add' && composerBaseSongRef.current) {
      const baseSong = composerBaseSongRef.current;
      currentSongRef.current = baseSong;
      setCurrentSong(baseSong);
      setSelectedNoteId(null);
    }
    composerBaseSongRef.current = null;
    provisionalNoteIdRef.current = null;
    setComposerRequest(null);
    setEditorMessage(null);
  }, [composerRequest]);

  const handleRecordingToggle = useCallback(() => {
    if (recordingEnabled) cancelComposerSession();
    setRecordingEnabled((enabled) => !enabled);
  }, [cancelComposerSession, recordingEnabled]);

  const handleScorePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || slurToolActive) return;
    const noteId = (e.target as Element).closest?.('[data-note-id]')?.getAttribute('data-note-id');
    if (!noteId || noteId !== selectedNoteId) return;
    dragRef.current = { noteId, startY: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events may not own capture; dragging still works via the container.
    }
  }, [selectedNoteId, slurToolActive]);

  const handleScorePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || Math.abs(e.clientY - dragRef.current.startY) < 4) return;
    setIsDraggingNote(true);
  }, []);

  const finishScorePointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsDraggingNote(false);
    if (!drag) return;
    const steps = Math.round((drag.startY - e.clientY) / 5);
    if (steps === 0) return;
    suppressNextClickRef.current = true;
    modifySelectedNote((note) => transposeNoteBySteps(note, steps));
    setEditorMessage(`Moved the selected ${getSelectedNote()?.keys.length === 1 ? 'note' : 'chord'} ${Math.abs(steps)} step${Math.abs(steps) === 1 ? '' : 's'} ${steps > 0 ? 'up' : 'down'}.`);
  }, [getSelectedNote, modifySelectedNote]);

  useEffect(() => {
    if (!scoreContextMenu) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.('.score-context-menu')) setScoreContextMenu(null);
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [scoreContextMenu]);

  useEffect(() => {
    if (!scoreContextMenu) return;
    const animationFrame = requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [scoreContextMenu]);

  const openSelectionMenu = useCallback((anchor?: HTMLElement | null) => {
    const anchorRect = anchor?.getBoundingClientRect();
    const x = Math.max(8, Math.min(
      anchorRect?.left ?? window.innerWidth / 2 - 109,
      window.innerWidth - 226,
    ));
    const y = Math.max(8, Math.min(
      anchorRect?.top ?? window.innerHeight / 2 - 80,
      window.innerHeight - 190,
    ));
    if (selectedNoteId) {
      const location = findNoteLocation(selectedNoteId);
      if (location) {
        setScoreContextMenu({ kind: 'note', x, y, noteId: selectedNoteId, location });
        return;
      }
    }
    const target = selectedBarTarget ?? {
      measureIdx: 0,
      clef: activeScore.staffLayout === 'bass-only' ? 'bass' as const : 'treble' as const,
      voiceIdx: 0,
    };
    setSelectedBarTarget(target);
    setScoreContextMenu({ kind: 'measure', x, y, target });
  }, [activeScore.staffLayout, findNoteLocation, selectedBarTarget, selectedNoteId]);

  const handleContextMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setScoreContextMenu(null);
      scoreRef.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(
      contextMenuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'ArrowDown'
      ? (currentIndex + 1 + items.length) % items.length
      : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }, []);

  const transposeSelectedNote = useCallback((direction: number) => {
    modifySelectedNote((note) => transposeNoteBySteps(note, direction));
  }, [modifySelectedNote]);

  const navigateNote = useCallback((direction: number) => {
    if (!selectedNoteId) return;
    const loc = findNoteLocation(selectedNoteId);
    if (!loc) return;
    const notes = getMeasureVoice(
      activeScore.measures[loc.measureIdx],
      loc.clef,
      loc.voiceIdx,
    );
    const newIdx = loc.noteIdx + direction;

    if (newIdx >= 0 && newIdx < notes.length) {
      setSelectedNoteId(notes[newIdx].id);
    } else if (newIdx < 0) {
      for (let measureIdx = loc.measureIdx - 1; measureIdx >= 0; measureIdx--) {
        const previous = getMeasureVoice(activeScore.measures[measureIdx], loc.clef, loc.voiceIdx);
        if (previous.length === 0) continue;
        setSelectedNoteId(previous[previous.length - 1].id);
        break;
      }
    } else if (newIdx >= notes.length) {
      for (let measureIdx = loc.measureIdx + 1; measureIdx < activeScore.measures.length; measureIdx++) {
        const next = getMeasureVoice(activeScore.measures[measureIdx], loc.clef, loc.voiceIdx);
        if (next.length === 0) continue;
        setSelectedNoteId(next[0].id);
        break;
      }
    }
  }, [selectedNoteId, findNoteLocation, activeScore]);

  const handleDeleteNote = useCallback(() => {
    if (!selectedNoteId) return;
    const loc = findNoteLocation(selectedNoteId);
    if (!loc) return;
    updateSong((song) => {
      const measures = song.measures.map((measure) => mapMeasureNotes(measure, (note) => (
          note.slurToNoteId === selectedNoteId ? { ...note, slurToNoteId: undefined } : note
        )));
      const newSong = { ...song, measures };
      const notes = [...getMeasureVoice(
        newSong.measures[loc.measureIdx],
        loc.clef,
        loc.voiceIdx,
      )];
      notes.splice(loc.noteIdx, 1);
      newSong.measures[loc.measureIdx] = replaceMeasureVoice(
        newSong.measures[loc.measureIdx],
        loc.clef,
        loc.voiceIdx,
        notes,
      );
      return newSong;
    });
    setSelectedNoteId(null);
    setScoreContextMenu(null);
    setComposerRequest(null);
  }, [selectedNoteId, findNoteLocation, updateSong]);

  const handleTie = useCallback(() => {
    if (!selectedNoteId) return;
    const location = findNoteLocation(selectedNoteId);
    const selected = getSelectedNote();
    if (!location || !selected || selected.isRest) return;
    if (selected.drumMidi) {
      setEditorMessage('Drum hits cannot be tied. Adjust their duration instead.');
      return;
    }
    if (selected.tieToNext) {
      modifySelectedNote((note) => ({ ...note, tieToNext: undefined }));
      return;
    }
    const nextLocation = findNextNoteLocation(location);
    if (!nextLocation) {
      setEditorMessage('A tie needs a following note in the same voice.');
      return;
    }
    const nextNote = getMeasureVoice(
      activeScore.measures[nextLocation.measureIdx],
      nextLocation.clef,
      nextLocation.voiceIdx,
    )[nextLocation.noteIdx];
    if (!nextNote || !notesHaveSamePitches(selected, nextNote, currentSong.keySignature)) {
      setEditorMessage('A tie can only connect to the next note or chord with the same pitches.');
      return;
    }
    modifySelectedNote((note) => ({ ...note, tieToNext: true }));
  }, [
    activeScore,
    currentSong.keySignature,
    findNextNoteLocation,
    findNoteLocation,
    getSelectedNote,
    modifySelectedNote,
    selectedNoteId,
  ]);

  const handleCopy = useCallback(() => {
    if (selectedNoteId) {
      const location = findNoteLocation(selectedNoteId);
      if (!location) return;
      const note = getMeasureVoice(
        activeScore.measures[location.measureIdx],
        location.clef,
        location.voiceIdx,
      )[location.noteIdx];
      if (!note) return;
      setEditorClipboard({
        kind: 'note',
        note: copyNoteData(note),
        source: {
          measureIdx: location.measureIdx,
          clef: location.clef,
          voiceIdx: location.voiceIdx,
        },
      });
      setEditorMessage(`Copied ${note.isRest ? 'rest' : note.keys.length > 1 ? 'chord' : 'note'} from bar ${location.measureIdx + 1}.`);
      return;
    }

    if (selectedBarTarget) {
      const measure = activeScore.measures[selectedBarTarget.measureIdx];
      if (!measure) return;
      setEditorClipboard({ kind: 'measure', measure: cloneMeasureForPaste(measure) });
      setEditorMessage(`Copied bar ${selectedBarTarget.measureIdx + 1}.`);
    }
  }, [activeScore, findNoteLocation, selectedBarTarget, selectedNoteId]);

  const handlePaste = useCallback(() => {
    if (!editorClipboard) return;
    const selectedLocation = selectedNoteId ? findNoteLocation(selectedNoteId) : null;

    if (editorClipboard.kind === 'measure') {
      const targetMeasureIdx = selectedLocation?.measureIdx
        ?? selectedBarTarget?.measureIdx
        ?? activeScore.measures.length - 1;
      const insertIdx = Math.max(0, Math.min(activeScore.measures.length, targetMeasureIdx + 1));
      const pastedMeasure = cloneMeasureForPaste(editorClipboard.measure);
      updateProject((song) => ({
        ...song,
        tracks: song.tracks.map((track) => ({
          ...track,
          measures: [
            ...track.measures.slice(0, insertIdx),
            track.id === activeTrackId ? pastedMeasure : createDefaultMeasure(),
            ...track.measures.slice(insertIdx),
          ],
        })),
      }));
      const clef = activeScore.staffLayout === 'bass-only'
        ? 'bass'
        : selectedBarTarget?.clef ?? selectedLocation?.clef ?? 'treble';
      setSelectedNoteId(null);
      setSelectedBarTarget({ measureIdx: insertIdx, clef, voiceIdx: 0 });
      setComposerRequest(null);
      setScoreContextMenu(null);
      setEditorMessage(`Pasted a copy as bar ${insertIdx + 1}.`);
      return;
    }

    const fallbackMeasureIdx = Math.max(
      0,
      Math.min(activeScore.measures.length - 1, editorClipboard.source.measureIdx),
    );
    const target: ScoreTarget = selectedLocation
      ? {
          measureIdx: selectedLocation.measureIdx,
          clef: selectedLocation.clef,
          voiceIdx: selectedLocation.voiceIdx,
        }
      : selectedBarTarget ?? {
          measureIdx: fallbackMeasureIdx,
          clef: editorClipboard.source.clef,
          voiceIdx: editorClipboard.source.voiceIdx,
        };
    const targetMeasure = activeScore.measures[target.measureIdx];
    if (!targetMeasure) return;
    const targetNotes = getMeasureVoice(targetMeasure, target.clef, target.voiceIdx);
    const pastedNote = cloneNoteForPaste(editorClipboard.note);
    if (
      getMeasureBeatCount(targetNotes) + getNoteBeatValue(pastedNote) >
      getMeasureCapacity(currentSong.timeSignature)
    ) {
      setEditorMessage(`Bar ${target.measureIdx + 1} does not have room for that ${pastedNote.keys.length > 1 ? 'chord' : 'note'}.`);
      return;
    }
    const insertIdx = selectedLocation ? selectedLocation.noteIdx + 1 : targetNotes.length;
    updateSong((song) => {
      const measures = song.measures.map((measure) => ({ ...measure }));
      const notes = [...getMeasureVoice(measures[target.measureIdx], target.clef, target.voiceIdx)];
      notes.splice(insertIdx, 0, pastedNote);
      measures[target.measureIdx] = replaceMeasureVoice(
        measures[target.measureIdx],
        target.clef,
        target.voiceIdx,
        notes,
      );
      return { ...song, measures };
    });
    setSelectedNoteId(pastedNote.id);
    setSelectedBarTarget(null);
    setComposerRequest(null);
    setScoreContextMenu(null);
    setEditorMessage(`Pasted ${pastedNote.isRest ? 'rest' : pastedNote.keys.length > 1 ? 'chord' : 'note'} into bar ${target.measureIdx + 1}.`);
  }, [
    activeScore,
    activeTrackId,
    currentSong,
    editorClipboard,
    findNoteLocation,
    selectedBarTarget,
    selectedNoteId,
    updateProject,
    updateSong,
  ]);

  // Playback
  const handlePlay = useCallback(async () => {
    if (playState === 'paused') {
      playbackEngine.resume();
      setPlayState('playing');
      return;
    }
    setPlayState('loading');
    setCurrentPlayMeasure(0);
    setHighlightedNoteIds([]);
    setActivePlaybackKeys([]);
    playbackEngine.onNotes((measureIdx, noteIds) => {
      setHighlightedNoteIds(noteIds);
      setCurrentPlayMeasure(measureIdx);
    });
    playbackEngine.onActiveKeys(setActivePlaybackKeys);
    playbackEngine.onStopped(() => {
      setPlayState('stopped');
      setHighlightedNoteIds([]);
      setActivePlaybackKeys([]);
      setCurrentPlayMeasure(0);
    });
    try {
      await playbackEngine.play(currentSong, activeTrackId, 0, loopEnabled, soloActiveTrack);
      if (playbackEngine.getState() === 'playing') {
        setPlayState('playing');
        if (playbackEngine.consumeFallbackSound()) {
          setEditorMessage('Grand Piano samples are unavailable, so playback is using Electric Keys.');
        }
      }
    } catch {
      playbackEngine.stop();
      setPlayState('stopped');
      setHighlightedNoteIds([]);
      setActivePlaybackKeys([]);
      setEditorMessage('That sound could not be prepared. Try another sound or check your connection.');
    }
  }, [activeTrackId, currentSong, loopEnabled, playState, soloActiveTrack]);

  const handlePause = useCallback(() => {
    playbackEngine.pause();
    setPlayState('paused');
  }, []);

  const handleStop = useCallback(() => {
    playbackEngine.stop();
    setPlayState('stopped');
    setHighlightedNoteIds([]);
    setActivePlaybackKeys([]);
    setCurrentPlayMeasure(0);
  }, []);

  const handleTrackChange = useCallback((trackId: string) => {
    if (!currentSong.tracks.some((track) => track.id === trackId) || trackId === activeTrackId) return;
    playbackEngine.setActiveTrack(trackId);
    setHighlightedNoteIds([]);
    setActivePlaybackKeys([]);
    setActiveTrackId(trackId);
    setSelectedNoteId(null);
    setSelectedBarTarget(null);
    setScoreContextMenu(null);
    setComposerRequest(null);
    setSlurToolActive(false);
    setPendingSlurStartId(null);
    setEditorMessage(null);
  }, [activeTrackId, currentSong.tracks]);

  const handleActiveTrackMuteToggle = useCallback(() => {
    const muted = !activeScore.muted;
    const nextSong = {
      ...replaceSongTrackFromScore(currentSong, { ...activeScore, muted }),
      updatedAt: Date.now(),
    };
    setSaveStatus('saving');
    try {
      saveSong(nextSong);
    } catch (error) {
      setSaveStatus('error');
      setEditorMessage(error instanceof Error ? error.message : 'This browser could not save locally.');
      return;
    }
    playbackEngine.setTrackMuted(activeTrackId, muted);
    setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), currentSong]);
    setRedoStack([]);
    setCurrentSong(nextSong);
    setSongs(loadSongs());
    setHighlightedNoteIds([]);
    setActivePlaybackKeys([]);
    setSaveStatus('saved');
  }, [activeScore, activeTrackId, currentSong]);

  const handleSoloActiveTrackToggle = useCallback(() => {
    setSoloActiveTrack((solo) => {
      const next = !solo;
      playbackEngine.setSoloActiveTrack(next);
      return next;
    });
    setHighlightedNoteIds([]);
    setActivePlaybackKeys([]);
  }, []);

  const handleInstrumentSoundChange = useCallback((sound: InstrumentSound) => {
    if (sound === activeScore.instrumentSound) return;
    const nextSong = {
      ...replaceSongTrackFromScore(currentSong, { ...activeScore, instrumentSound: sound }),
      updatedAt: Date.now(),
    };
    setSaveStatus('saving');
    try {
      saveSong(nextSong);
    } catch (error) {
      setSaveStatus('error');
      setEditorMessage(error instanceof Error ? error.message : 'This browser could not save locally.');
      return;
    }
    setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), currentSong]);
    setRedoStack([]);
    setCurrentSong(nextSong);
    setSongs(loadSongs());
    setSaveStatus('saved');
    void playbackEngine.setTrackInstrument(activeTrackId, sound).then(() => {
      if (playbackEngine.consumeFallbackSound()) {
        setEditorMessage('Grand Piano samples are unavailable, so Electric Keys will be used for now.');
      }
    }).catch(() => {
      setEditorMessage('That sound could not be prepared. Try another sound or check your connection.');
    });
  }, [activeScore, activeTrackId, currentSong]);

  const handleSynthControlsChange = useCallback((controls: SynthControls) => {
    const nextScore = { ...activeScore, synthControls: controls };
    const nextSong = {
      ...replaceSongTrackFromScore(currentSong, nextScore),
      updatedAt: Date.now(),
    };
    try {
      saveSong(nextSong);
      setCurrentSong(nextSong);
      setSongs(loadSongs());
      setSaveStatus('saved');
    } catch (error) {
      setSaveStatus('error');
      setEditorMessage(error instanceof Error ? error.message : 'This browser could not save locally.');
    }
    playbackEngine.setSynthControls(controls);
  }, [activeScore, currentSong]);

  const handleLoopToggle = useCallback(() => {
    setLoopEnabled((enabled) => {
      const next = !enabled;
      playbackEngine.setLoop(next);
      return next;
    });
  }, []);

  const handleNoteNameModeChange = useCallback((requestedMode: Exclude<NoteNameMode, 'off'>) => {
    setNoteNameMode((currentMode) => {
      const nextMode: NoteNameMode = currentMode === requestedMode ? 'off' : requestedMode;
      try {
        localStorage.setItem(NOTE_NAMES_STORAGE_KEY, nextMode);
      } catch {
        // This visual preference can remain session-only when storage is unavailable.
      }
      return nextMode;
    });
  }, []);

  const handlePreviewNotes = useCallback((keys: string[]) => {
    void playbackEngine.previewNotes(keys, instrumentSound).then(() => {
      if (playbackEngine.consumeFallbackSound()) {
        setEditorMessage('Grand Piano samples are unavailable, so this preview used Electric Keys.');
      }
    }).catch(() => {
      setEditorMessage('That sound could not be prepared. Try another preset or check your connection.');
    });
  }, [instrumentSound]);

  useEffect(() => {
    // Start fetching/constructing the chosen instrument before the first Play
    // click. The browser audio context is still resumed only after interaction.
    void playbackEngine.prepare(instrumentSound).catch(() => {
      // Play reports an actionable error if preparation still fails later.
    });
  }, [instrumentSound]);

  useEffect(() => {
    playbackEngine.setSynthControls(synthControls);
  }, [synthControls]);

  useEffect(() => () => playbackEngine.stop(), []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const shortcutKey = e.key.toLowerCase();
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) return;

      if (composerRequest) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setScoreContextMenu(null);
          cancelComposerSession();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && shortcutKey === 'z' && !e.shiftKey) {
        e.preventDefault(); handleUndo(); return;
      }
      if ((e.metaKey || e.ctrlKey) && (shortcutKey === 'y' || (shortcutKey === 'z' && e.shiftKey))) {
        e.preventDefault(); handleRedo(); return;
      }
      if ((e.metaKey || e.ctrlKey) && shortcutKey === 'c') {
        e.preventDefault(); handleCopy(); return;
      }
      if ((e.metaKey || e.ctrlKey) && shortcutKey === 'v') {
        e.preventDefault(); handlePaste(); return;
      }

      switch (e.key) {
        case 'Escape':
          setSlurToolActive(false);
          setPendingSlurStartId(null);
          setScoreContextMenu(null);
          setPendingDeleteSongId(null);
          setEditorMessage(null);
          break;
        case '1': setSelectedDuration('w'); modifySelectedNote((n) => ({ ...n, duration: 'w' })); break;
        case '2': setSelectedDuration('h'); modifySelectedNote((n) => ({ ...n, duration: 'h' })); break;
        case '3': setSelectedDuration('q'); modifySelectedNote((n) => ({ ...n, duration: 'q' })); break;
        case '4': setSelectedDuration('8'); modifySelectedNote((n) => ({ ...n, duration: '8' })); break;
        case '5': setSelectedDuration('16'); modifySelectedNote((n) => ({ ...n, duration: '16' })); break;
        case 'r': setIsRestMode((v) => !v); break;
        case '.': setIsDotted((v) => !v); break;
        case 't': handleTie(); break;
        case 'Delete':
        case 'Backspace':
          if (selectedNoteId) { e.preventDefault(); handleDeleteNote(); }
          break;
        case 'ArrowRight': navigateNote(1); break;
        case 'ArrowLeft': navigateNote(-1); break;
        case 'ArrowUp': e.preventDefault(); transposeSelectedNote(1); break;
        case 'ArrowDown': e.preventDefault(); transposeSelectedNote(-1); break;
        case ' ':
          e.preventDefault();
          if (playState === 'playing') handlePause();
          else if (playState === 'loading') handleStop();
          else if (playState === 'paused') handlePlay();
          else handlePlay();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modifySelectedNote, selectedNoteId, handleDeleteNote, navigateNote, transposeSelectedNote, playState, handlePlay, handlePause, handleStop, handleUndo, handleRedo, handleCopy, handlePaste, handleTie, composerRequest, cancelComposerSession]);

  // Add note with beat validation
  const handleAddNote = (keys: string[], clef: 'treble' | 'bass') => {
    const explicitTarget = composerRequest?.mode === 'add'
      ? composerRequest.target ?? selectedBarTarget
      : selectedBarTarget;
    let measureIdx = explicitTarget?.measureIdx ?? 0;
    let insertIdx = -1;
    let voiceIdx = explicitTarget?.voiceIdx ?? 0;
    let targetClef = activeScore.kind === 'percussion'
      ? 'treble' as const
      : explicitTarget?.clef ?? clef;

    if (!explicitTarget && selectedNoteId) {
      const loc = findNoteLocation(selectedNoteId);
      if (loc) {
        measureIdx = loc.measureIdx;
        if (loc.clef === clef) {
          insertIdx = loc.noteIdx + 1;
          voiceIdx = loc.voiceIdx;
          targetClef = loc.clef;
        }
      }
    }

    const normalized = normalizePianoKeys(keys, currentSong.keySignature);
    const drumMidi = activeScore.kind === 'percussion'
      ? keys.map(pianoKeyToMidi)
      : undefined;
    const newNote: NoteEntry = {
      id: createId(),
      keys: isRestMode
        ? (targetClef === 'treble' ? ['b/4'] : ['d/3'])
        : drumMidi?.map(drumMidiToStaffKey) ?? normalized.keys,
      duration: selectedDuration,
      isRest: isRestMode,
      dotted: isDotted || undefined,
      accidentals: !isRestMode && !drumMidi ? normalized.accidentals : undefined,
      drumMidi: !isRestMode ? drumMidi : undefined,
    };

    const newNoteBeats = getNoteBeatValue(newNote);
    const capacity = getMeasureCapacity(currentSong.timeSignature);
    if (newNoteBeats > capacity) {
      setEditorMessage(`A ${isDotted ? 'dotted ' : ''}${selectedDuration} note will not fit in this time signature.`);
      return false;
    }

    const notesInTarget = getMeasureVoice(
      activeScore.measures[measureIdx],
      targetClef,
      voiceIdx,
    );
    if (getMeasureBeatCount(notesInTarget) + newNoteBeats > capacity) {
      if (explicitTarget) {
        setEditorMessage(`Bar ${measureIdx + 1} does not have room for that ${isRestMode ? 'rest' : keys.length > 1 ? 'chord' : 'note'}.`);
        return false;
      }
      let nextMeasureIdx = measureIdx + 1;
      while (nextMeasureIdx < activeScore.measures.length) {
        const nextNotes = getMeasureVoice(
          activeScore.measures[nextMeasureIdx],
          targetClef,
          voiceIdx,
        );
        if (getMeasureBeatCount(nextNotes) + newNoteBeats <= capacity) break;
        nextMeasureIdx++;
      }
      measureIdx = nextMeasureIdx;
      insertIdx = -1;
    }

    updateProject((song) => {
      const tracks = song.tracks.map((track) => {
        const measures = track.measures.map((measure) => ({ ...measure }));
        while (measures.length <= measureIdx) measures.push(createDefaultMeasure());
        if (track.id !== activeTrackId) return { ...track, measures };
        const notes = [...getMeasureVoice(measures[measureIdx], targetClef, voiceIdx)];
        if (insertIdx >= 0) notes.splice(insertIdx, 0, newNote);
        else notes.push(newNote);
        measures[measureIdx] = replaceMeasureVoice(
          measures[measureIdx],
          targetClef,
          voiceIdx,
          notes,
        );
        return { ...track, measures };
      });
      return { ...song, tracks };
    });
    setSelectedNoteId(newNote.id);
    if (explicitTarget) setSelectedBarTarget({ measureIdx, clef: targetClef, voiceIdx });
    setEditorMessage(null);
    return true;
  };

  const handleDeleteMeasure = () => {
    if (activeScore.measures.length <= 1) return;
    const loc = selectedNoteId ? findNoteLocation(selectedNoteId) : null;
    const measureIdx = loc?.measureIdx
      ?? selectedBarTarget?.measureIdx
      ?? activeScore.measures.length - 1;
    updateProject((song) => {
      const removedNoteIds = new Set(song.tracks.flatMap((track) => (
        track.measures[measureIdx] ? getMeasureNoteIds(track.measures[measureIdx]) : []
      )));
      return {
        ...song,
        tracks: song.tracks.map((track) => ({
          ...track,
          measures: track.measures
            .filter((_, index) => index !== measureIdx)
            .map((measure) => mapMeasureNotes(measure, (note) => (
              note.slurToNoteId && removedNoteIds.has(note.slurToNoteId)
                ? { ...note, slurToNoteId: undefined }
                : note
            ))),
        })),
      };
    });
    setSelectedNoteId(null);
    setSelectedBarTarget(null);
    setComposerRequest(null);
  };

  const handleAddMeasure = () => {
    const measureIdx = activeScore.measures.length;
    const clef = activeScore.staffLayout === 'bass-only'
      ? 'bass'
      : selectedBarTarget?.clef ?? 'treble';
    updateProject((song) => ({
      ...song,
      tracks: song.tracks.map((track) => ({
        ...track,
        measures: [...track.measures, createDefaultMeasure()],
      })),
    }));
    setSelectedNoteId(null);
    setSelectedBarTarget({ measureIdx, clef, voiceIdx: 0 });
    setComposerRequest(null);
    setEditorMessage(`Bar ${measureIdx + 1} selected. Click a piano key to add directly to it, or right-click it for Add note(s).`);
  };

  const handleAccidental = (acc: Accidental) => {
    modifySelectedNote((note) => {
      if (note.isRest || note.drumMidi) return note;
      const toneIndex = Math.max(0, Math.min(note.keys.length - 1, selectedChordToneIndex));
      const accidentals = note.keys.map((_, index) => note.accidentals?.[index] ?? null);
      accidentals[toneIndex] = accidentals[toneIndex] === acc ? null : acc;
      return {
        ...note,
        accidentals: accidentals.some(Boolean) ? accidentals : undefined,
        suppressAccidentals: undefined,
      };
    });
  };

  const handleDynamic = (dyn: Dynamic) => {
    modifySelectedNote((note) => ({
      ...note, dynamic: note.dynamic === dyn ? undefined : dyn,
    }));
  };

  const handleArticulation = (art: Articulation) => {
    modifySelectedNote((note) => {
      const existing = note.articulations || [];
      const has = existing.includes(art);
      return { ...note, articulations: has ? existing.filter((a) => a !== art) : [...existing, art] };
    });
  };

  const handleRepeatStart = () => {
    const loc = selectedNoteId ? findNoteLocation(selectedNoteId) : null;
    const measureIdx = loc?.measureIdx ?? selectedBarTarget?.measureIdx ?? 0;
    const enabled = !activeScore.measures[measureIdx]?.repeatStart;
    updateProject((song) => {
      const tracks = song.tracks.map((track) => ({
        ...track,
        measures: track.measures.map((measure, index) => (
          index === measureIdx ? { ...measure, repeatStart: enabled } : measure
        )),
      }));
      return { ...song, tracks };
    });
  };

  const handleRepeatEnd = () => {
    const loc = selectedNoteId ? findNoteLocation(selectedNoteId) : null;
    const measureIdx = loc?.measureIdx
      ?? selectedBarTarget?.measureIdx
      ?? activeScore.measures.length - 1;
    const enabled = !activeScore.measures[measureIdx]?.repeatEnd;
    updateProject((song) => {
      const tracks = song.tracks.map((track) => ({
        ...track,
        measures: track.measures.map((measure, index) => (
          index === measureIdx ? { ...measure, repeatEnd: enabled } : measure
        )),
      }));
      return { ...song, tracks };
    });
  };

  const handleNewSong = () => {
    handleStop();
    const newSong = createDefaultSong();
    setSaveStatus('saving');
    try {
      saveSong(newSong);
    } catch (error) {
      setSaveStatus('error');
      setEditorMessage(error instanceof Error ? error.message : 'This browser could not save locally.');
      return;
    }
    setCurrentSongId(newSong.id);
    setCurrentSong(newSong);
    setActiveTrackId(newSong.tracks[0].id);
    setSongs(loadSongs());
    setSelectedNoteId(null);
    setSelectedBarTarget(null);
    setScoreContextMenu(null);
    setComposerRequest(null);
    setSlurToolActive(false);
    setPendingSlurStartId(null);
    setEditorMessage(null);
    setUndoStack([]); setRedoStack([]);
    setSaveStatus('saved');
  };

  const handleSelectSong = (id: string) => {
    const song = songs.find((s) => s.id === id);
    if (song) {
      handleStop();
      setCurrentSong(song);
      setActiveTrackId(song.tracks[0].id);
      setCurrentSongId(id);
      setSelectedNoteId(null);
      setSelectedBarTarget(null);
      setScoreContextMenu(null);
      setComposerRequest(null);
      setSlurToolActive(false);
      setPendingSlurStartId(null);
      setEditorMessage(null);
      setUndoStack([]); setRedoStack([]);
    }
  };

  const handleDeleteSong = (id: string) => {
    const song = songs.find((candidate) => candidate.id === id);
    if (!song) return;
    setPendingDeleteSongId(id);
  };

  const confirmDeleteSong = () => {
    if (!pendingDeleteSongId) return;
    const id = pendingDeleteSongId;
    const song = songs.find((candidate) => candidate.id === id);
    setPendingDeleteSongId(null);
    if (!song) return;
    const wasCurrent = id === currentSong.id;
    if (id === currentSong.id) handleStop();
    setSaveStatus('saving');
    try {
      deleteStoredSong(id);
    } catch (error) {
      setSaveStatus('error');
      setEditorMessage(error instanceof Error ? error.message : 'This browser could not update local storage.');
      return;
    }
    setDeletedSongUndo({ song, wasCurrent });
    const remaining = loadSongs();
    setSongs(remaining);
    if (id === currentSong.id) {
      if (remaining.length > 0) {
        setCurrentSong(remaining[0]);
        setActiveTrackId(remaining[0].tracks[0].id);
        setCurrentSongId(remaining[0].id);
      }
      else handleNewSong();
      setSelectedNoteId(null);
      setSelectedBarTarget(null);
      setScoreContextMenu(null);
      setComposerRequest(null);
      setSlurToolActive(false);
      setPendingSlurStartId(null);
    }
    setSaveStatus('saved');
  };

  const undoDeleteSong = () => {
    if (!deletedSongUndo) return;
    setSaveStatus('saving');
    try {
      saveSong(deletedSongUndo.song);
      const restoredSongs = loadSongs();
      setSongs(restoredSongs);
      if (deletedSongUndo.wasCurrent) {
        handleStop();
        setCurrentSong(deletedSongUndo.song);
        setActiveTrackId(deletedSongUndo.song.tracks[0].id);
        setCurrentSongId(deletedSongUndo.song.id);
      }
      setDeletedSongUndo(null);
      setSaveStatus('saved');
      setEditorMessage(`Restored “${deletedSongUndo.song.title || 'Untitled'}”.`);
    } catch (error) {
      setSaveStatus('error');
      setEditorMessage(error instanceof Error ? error.message : 'The song could not be restored.');
    }
  };

  const handleExport = () => exportSongToJson(currentSong);

  const handleImport = async (file: File) => {
    try {
      const isMidi = /\.(?:mid|midi)$/i.test(file.name) || /midi/i.test(file.type);
      const midiResult = isMidi ? await importSongFromMidi(file) : null;
      const importedSong = midiResult?.song ?? await importSongFromJson(file);
      const now = Date.now();
      const song = { ...importedSong, id: createId(), createdAt: now, updatedAt: now };
      handleStop();
      setSaveStatus('saving');
      saveSong(song);
      setCurrentSong(song);
      setActiveTrackId(song.tracks[0].id);
      setCurrentSongId(song.id);
      setSongs(loadSongs());
      setSelectedNoteId(null);
      setSelectedBarTarget(null);
      setScoreContextMenu(null);
      setComposerRequest(null);
      setSlurToolActive(false);
      setPendingSlurStartId(null);
      setEditorMessage(midiResult
        ? `Converted ${midiResult.importedTrackCount} MIDI track${midiResult.importedTrackCount === 1 ? '' : 's'} into editable score notes.${midiResult.warnings.length > 0 ? ` ${midiResult.warnings.join(' ')}` : ''}`
        : null);
      setUndoStack([]); setRedoStack([]);
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error');
      setEditorMessage(`Import failed: ${err instanceof Error ? err.message : 'Invalid song file'}`);
    }
  };

  const handleSlurToolToggle = () => {
    if (slurToolActive) {
      setSlurToolActive(false);
      setPendingSlurStartId(null);
      setEditorMessage(null);
      return;
    }
    setSlurToolActive(true);
    setPendingSlurStartId(null);
    setEditorMessage('Slur: select the starting note.');
  };

  const handleTimeSignatureChange = (timeSignature: [number, number]) => {
    const nextCapacity = getMeasureCapacity(timeSignature);
    for (const track of currentSong.tracks) {
      for (let measureIdx = 0; measureIdx < track.measures.length; measureIdx++) {
        for (const clef of ['treble', 'bass'] as const) {
          const overflowingVoice = getMeasureVoices(track.measures[measureIdx], clef)
            .findIndex((voice) => getMeasureBeatCount(voice) > nextCapacity + 1e-9);
          if (overflowingVoice >= 0) {
            setEditorMessage(
              `Cannot change to ${timeSignature[0]}/${timeSignature[1]}: ${track.name}, bar ${measureIdx + 1}, ${clef} voice ${overflowingVoice + 1} is too long.`,
            );
            return;
          }
        }
      }
    }
    updateSong((song) => ({ ...song, timeSignature }));
    setEditorMessage(null);
  };

  const selectedNote = getSelectedNote();
  const pendingDeleteSong = pendingDeleteSongId
    ? songs.find((song) => song.id === pendingDeleteSongId) ?? null
    : null;
  const canCopy = Boolean(selectedNoteId || selectedBarTarget);
  const selectedNoteLabel = selectedNote?.isRest
    ? 'Rest'
    : selectedNote?.drumMidi
      ? selectedNote.drumMidi.map((midi) => GENERAL_MIDI_DRUM_NAMES[midi] ?? `Drum ${midi}`).join(', ')
    : selectedNote?.keys.map((key, index) => {
        const [name, octave] = key.split('/');
        const accidental = selectedNote.accidentals?.[index];
        return `${name}${accidental && accidental !== 'n' ? accidental : ''}/${octave}`;
      }).join(', ');

  // Compute beat info for status bar
  const selectedLoc = selectedNoteId ? findNoteLocation(selectedNoteId) : null;
  const measureBeats = selectedLoc
    ? getMeasureBeatCount(
        getMeasureVoice(
          activeScore.measures[selectedLoc.measureIdx],
          selectedLoc.clef,
          selectedLoc.voiceIdx,
        )
      )
    : 0;
  const capacity = getMeasureCapacity(currentSong.timeSignature);
  const composerLabel = composerRequest?.mode === 'edit'
    ? `Editing ${selectedNote && selectedNote.keys.length > 1 ? 'chord' : 'note'}`
    : composerRequest?.target
      ? `Bar ${composerRequest.target.measureIdx + 1} · ${activeScore.voiceLabels?.[composerRequest.target.clef]?.[composerRequest.target.voiceIdx] ?? (composerRequest.target.voiceIdx === 0 ? 'upper voice' : 'lower voice')}`
      : '';

  return (
    <div className="app">
      <PlaybackBar
        songId={currentSong.id}
        playState={playState}
        loopEnabled={loopEnabled}
        recordingEnabled={recordingEnabled}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onLoopToggle={handleLoopToggle}
        onRecordingToggle={handleRecordingToggle}
        songTitle={currentSong.title}
        onTitleChange={(title) => updateSong((song) => song.title === title ? song : { ...song, title })}
        currentMeasure={currentPlayMeasure}
        totalMeasures={activeScore.measures.length}
        tracks={currentSong.tracks}
        activeTrackId={activeTrackId}
        soloActiveTrack={soloActiveTrack}
        onTrackChange={handleTrackChange}
        onSoloActiveTrackToggle={handleSoloActiveTrackToggle}
        onActiveTrackMuteToggle={handleActiveTrackMuteToggle}
      />
      <Toolbar
        selectedDuration={selectedDuration}
        onDurationChange={(d) => {
          setSelectedDuration(d);
          if (selectedNoteId) modifySelectedNote((n) => ({ ...n, duration: d }));
        }}
        isRestMode={isRestMode}
        onRestModeToggle={() => setIsRestMode((v) => !v)}
        isDotted={isDotted}
        onDottedToggle={() => setIsDotted((v) => !v)}
        onAccidental={handleAccidental}
        onDynamic={handleDynamic}
        onArticulation={handleArticulation}
        onTie={handleTie}
        onSlurToolToggle={handleSlurToolToggle}
        isSlurToolActive={slurToolActive}
        isSlurStartPending={Boolean(pendingSlurStartId)}
        onPedalStart={() => modifySelectedNote((n) => ({ ...n, pedalStart: !n.pedalStart }))}
        onPedalEnd={() => modifySelectedNote((n) => ({ ...n, pedalEnd: !n.pedalEnd }))}
        onRepeatStart={handleRepeatStart}
        onRepeatEnd={handleRepeatEnd}
        onAddMeasure={handleAddMeasure}
        onDeleteNote={handleDeleteNote}
        onDeleteMeasure={handleDeleteMeasure}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCopy={handleCopy}
        onPaste={handlePaste}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        canCopy={canCopy}
        canPaste={Boolean(editorClipboard)}
        canDeleteMeasure={activeScore.measures.length > 1}
        selectedNote={selectedNote}
        selectedChordToneIndex={selectedChordToneIndex}
        onSelectedChordToneIndexChange={setSelectedChordToneIndex}
        noteNameMode={noteNameMode}
        onNoteNameModeChange={handleNoteNameModeChange}
        tempo={currentSong.tempo}
        timeSignature={currentSong.timeSignature}
        keySignature={currentSong.keySignature}
        onTempoChange={(tempo) => updateSong((song) => song.tempo === tempo ? song : { ...song, tempo })}
        onTimeSignatureChange={handleTimeSignatureChange}
        onKeySignatureChange={(keySignature) => updateSong((song) => (
          song.keySignature === keySignature ? song : { ...song, keySignature }
        ))}
      />
      <div className="main-content">
        <SongManager
          songs={songs}
          currentSongId={currentSong.id}
          onSelectSong={handleSelectSong}
          onNewSong={handleNewSong}
          onDeleteSong={handleDeleteSong}
          onExport={handleExport}
          onImport={handleImport}
        />
        <div className="editor-area">
          <div
            className={`score-container ${slurToolActive ? 'slur-mode' : ''} ${isDraggingNote ? 'dragging-note' : ''}`}
            ref={scoreRef}
            onClick={handleScoreClick}
            onContextMenu={handleScoreContextMenu}
            onPointerDown={handleScorePointerDown}
            onPointerMove={handleScorePointerMove}
            onPointerUp={finishScorePointer}
            onPointerCancel={finishScorePointer}
            onKeyDown={(event) => {
              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10') || event.key === 'Enter') {
                if (selectedNoteId || selectedBarTarget) {
                  event.preventDefault();
                  openSelectionMenu(event.currentTarget);
                }
              }
            }}
            tabIndex={0}
            aria-label="Interactive sheet music. Click a bar to select it, or right-click for editing actions."
          />
          {scoreContextMenu && (
            <div
              className="score-context-menu"
              style={{ left: scoreContextMenu.x, top: scoreContextMenu.y }}
              role="menu"
              ref={contextMenuRef}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={handleContextMenuKeyDown}
            >
              {scoreContextMenu.kind === 'measure' ? (
                <>
                  <div className="score-context-title">
                    Bar {scoreContextMenu.target.measureIdx + 1}
                    <span>
                      {activeScore.voiceLabels?.[scoreContextMenu.target.clef]?.[scoreContextMenu.target.voiceIdx]
                        ?? (scoreContextMenu.target.voiceIdx === 0 ? 'Upper voice' : 'Lower voice')}
                    </span>
                  </div>
                  <button type="button" role="menuitem" onClick={() => beginAddingNotes(scoreContextMenu.target)}>
                    <span className="context-menu-icon">♪</span>
                    Add note(s)
                    <kbd>Enter</kbd>
                  </button>
                  {getMeasureVoices(
                    activeScore.measures[scoreContextMenu.target.measureIdx],
                    scoreContextMenu.target.clef,
                  ).length === 1 && (
                    <button type="button" role="menuitem" onClick={() => addLowerVoice(scoreContextMenu.target)}>
                      <span className="context-menu-icon">𝄢</span>
                      Add lower voice
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="score-context-title">
                    {selectedNote?.isRest ? 'Rest' : selectedNote && selectedNote.keys.length > 1 ? 'Chord' : 'Note'}
                    <span>Bar {scoreContextMenu.location.measureIdx + 1}</span>
                  </div>
                  {!selectedNote?.isRest && (
                    <button type="button" role="menuitem" onClick={() => beginEditingNote(scoreContextMenu.noteId)}>
                      <span className="context-menu-icon">✎</span>
                      Edit {selectedNote && selectedNote.keys.length > 1 ? 'chord' : 'note'}
                      <kbd>Enter</kbd>
                    </button>
                  )}
                  <button type="button" role="menuitem" className="context-danger" onClick={handleDeleteNote}>
                    <span className="context-menu-icon">×</span>
                    Delete {selectedNote?.isRest ? 'rest' : selectedNote && selectedNote.keys.length > 1 ? 'chord' : 'note'}
                  </button>
                </>
              )}
            </div>
          )}
          <div className="status-bar" role="status" aria-live="polite">
            {editorMessage ? (
              <span className="status-message">{editorMessage}</span>
            ) : selectedNote && selectedLoc ? (
              <span className="status-note-info">
                <strong>{selectedNoteLabel}</strong>
                {' '}&middot;{' '}
                {selectedNote.duration === 'w' ? 'Whole' : selectedNote.duration === 'h' ? 'Half' : selectedNote.duration === 'q' ? 'Quarter' : selectedNote.duration === '8' ? '8th' : '16th'}
                {selectedNote.isRest ? ' rest' : ' note'}
                {selectedNote.dotted ? ' (dotted)' : ''}
                {selectedNote.dynamic ? ` | ${selectedNote.dynamic}` : ''}
                {selectedNote.articulations?.length ? ` | ${selectedNote.articulations.join(', ')}` : ''}
                {selectedNote.tieToNext ? ' | tied' : ''}
                <span className="status-beats"> | Bar {selectedLoc.measureIdx + 1}: {measureBeats}/{capacity} beats</span>
              </span>
            ) : selectedBarTarget ? (
              <span className="status-note-info">
                <strong>Bar {selectedBarTarget.measureIdx + 1}</strong>
                {' '}&middot;{' '}
                {activeScore.voiceLabels?.[selectedBarTarget.clef]?.[selectedBarTarget.voiceIdx]
                  ?? (selectedBarTarget.voiceIdx === 0 ? 'Upper voice' : 'Lower voice')}
                {' '}&middot;{' '}Piano input will be added here
              </span>
            ) : (
              <span className="status-hint">Select a note to edit it, or use the piano below to begin in bar 1</span>
            )}
            <div className="status-meta">
              {deletedSongUndo && (
                <button type="button" className="undo-delete-btn" onClick={undoDeleteSong}>
                  Undo delete
                </button>
              )}
              {(selectedNote || selectedBarTarget) && (
                <button
                  type="button"
                  className="selection-actions-btn"
                  onClick={(event) => openSelectionMenu(event.currentTarget)}
                  aria-haspopup="menu"
                  aria-expanded={Boolean(scoreContextMenu)}
                >
                  Actions
                </button>
              )}
              <span className={`save-status ${saveStatus}`}>
                {saveStatus === 'error' ? 'Save failed' : saveStatus === 'saving' ? 'Saving…' : 'Saved locally'}
              </span>
              <span className="status-shortcuts">
                {composerRequest?.mode === 'add' ? (
                  <>Click a piano key again to remove it &middot; Enter: finish &middot; Escape: cancel</>
                ) : selectedNote ? (
                  <>{selectedNote.isRest ? '↑/↓: move rest' : 'Drag: move · click above/below: add tone'} &middot; Cmd/Ctrl+C/V: copy/paste &middot; ←/→: navigate</>
                ) : selectedBarTarget ? (
                  <>Cmd/Ctrl+C/V: copy/paste bar &middot; Right-click: add notes &middot; Click piano: add note</>
                ) : (
                  <>Space: play/pause &middot; Cmd/Ctrl+Z: undo &middot; Cmd/Ctrl+Shift+Z: redo</>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
      {pendingDeleteSong && (
        <div className="confirmation-backdrop" role="presentation" onPointerDown={() => setPendingDeleteSongId(null)}>
          <div
            className="confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-song-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h2 id="delete-song-title">Delete this song?</h2>
            <p>“{pendingDeleteSong.title || 'Untitled'}” will be removed from this browser. You can undo immediately afterward.</p>
            <div className="confirmation-actions">
              <button type="button" autoFocus onClick={() => setPendingDeleteSongId(null)}>Cancel</button>
              <button type="button" className="confirm-danger" onClick={confirmDeleteSong}>Delete song</button>
            </div>
          </div>
        </div>
      )}
      <NoteInput
        key={`${activeTrackId}-${recordingEnabled ? 'record' : 'free'}-${composerRequest ? `composer-${composerRequest.id}` : selectedNote?.id ?? 'no-selection'}`}
        onAddNote={handleAddNote}
        selectedNote={selectedNote}
        session={composerRequest ? { mode: composerRequest.mode, label: composerLabel } : null}
        onPreviewKeysChange={previewComposerKeys}
        onSessionCommit={commitComposerSession}
        onSessionCancel={cancelComposerSession}
        activePlaybackKeys={activePlaybackKeys}
        instrumentSound={instrumentSound}
        synthControls={synthControls}
        onInstrumentSoundChange={handleInstrumentSoundChange}
        onSynthControlsChange={handleSynthControlsChange}
        onPreviewNotes={handlePreviewNotes}
        showAllNoteNames={noteNameMode !== 'off'}
        trackKind={activeScore.kind}
        recordingEnabled={recordingEnabled}
        onUpdateSelectedKeys={(keys) => {
          if (activeScore.kind === 'percussion') {
            const drumMidi = keys.map(pianoKeyToMidi);
            modifySelectedNote((note) => ({
              ...note,
              keys: drumMidi.map(drumMidiToStaffKey),
              drumMidi,
              accidentals: undefined,
              suppressAccidentals: undefined,
            }));
            return;
          }
          const normalized = normalizePianoKeys(keys, currentSong.keySignature);
          modifySelectedNote((note) => ({
            ...note,
            keys: normalized.keys,
            accidentals: normalized.accidentals,
            suppressAccidentals: undefined,
          }));
        }}
      />
    </div>
  );
}

export default App;
