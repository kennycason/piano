import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Toolbar } from './components/Toolbar/Toolbar';
import { PlaybackBar } from './components/PlaybackBar/PlaybackBar';
import { SongManager } from './components/SongManager/SongManager';
import { NoteInput } from './components/ScoreEditor/NoteInput';
import type {
  Song,
  NoteEntry,
  NoteDuration,
  Accidental,
  Dynamic,
  Articulation,
  StaffClef,
} from './models/song';
import {
  createDefaultSong,
  createDefaultMeasure,
  createId,
  getMeasureBeatCount,
  getMeasureCapacity,
  getNoteBeatValue,
  getMeasureVoice,
  getMeasureVoices,
  replaceMeasureVoice,
  mapMeasureNotes,
  getMeasureNoteIds,
} from './models/song';
import {
  loadSongs,
  saveSong,
  deleteSong as deleteStoredSong,
  setCurrentSongId,
  getCurrentSongId,
  exportSongToJson,
  importSongFromJson,
} from './services/storage';
import { renderSong, type RenderResult } from './services/renderer';
import { playbackEngine, type InstrumentSound } from './services/playback';
import './App.css';

const MAX_HISTORY = 50;
const PITCH_NAMES = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const INSTRUMENT_STORAGE_KEY = 'piano_sheet_instrument';
type PlayState = 'stopped' | 'loading' | 'playing' | 'paused';
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

function transposeNoteBySteps(note: NoteEntry, steps: number): NoteEntry {
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

function normalizePianoKeys(keys: string[]): {
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
    return null;
  });
  return {
    keys: normalizedKeys,
    accidentals: accidentals.some(Boolean) ? accidentals : undefined,
  };
}

function createInitialLibrary(): { songs: Song[]; currentSong: Song } {
  const savedSongs = loadSongs();
  const savedId = getCurrentSongId();
  const currentSong = savedSongs.find((song) => song.id === savedId) ?? savedSongs[0];
  if (currentSong) return { songs: savedSongs, currentSong };

  const newSong = createDefaultSong();
  return { songs: [newSong], currentSong: newSong };
}

function getInitialInstrument(): InstrumentSound {
  const saved = localStorage.getItem(INSTRUMENT_STORAGE_KEY);
  return saved === 'electric-keys' || saved === 'warm-pad' || saved === 'music-box'
    ? saved
    : 'grand-piano';
}

function App() {
  const [initialLibrary] = useState(createInitialLibrary);
  const [songs, setSongs] = useState<Song[]>(initialLibrary.songs);
  const [currentSong, setCurrentSong] = useState<Song>(initialLibrary.currentSong);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<NoteDuration>('q');
  const [isRestMode, setIsRestMode] = useState(false);
  const [isDotted, setIsDotted] = useState(false);
  const [playState, setPlayState] = useState<PlayState>('stopped');
  const [instrumentSound, setInstrumentSound] = useState<InstrumentSound>(getInitialInstrument);
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

  // Undo/redo history
  const [undoStack, setUndoStack] = useState<Song[]>([]);
  const [redoStack, setRedoStack] = useState<Song[]>([]);

  const scoreRef = useRef<HTMLDivElement>(null);
  const currentSongRef = useRef(currentSong);
  const noteMapRef = useRef<RenderResult['noteElements']>(new Map());
  const measureRegionsRef = useRef<RenderResult['measureRegions']>([]);
  const dragRef = useRef<{ noteId: string; startY: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const composerRequestIdRef = useRef(0);
  const composerBaseSongRef = useRef<Song | null>(null);
  const provisionalNoteIdRef = useRef<string | null>(null);
  const playbackAnimationRef = useRef<number | null>(null);

  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
    saveSong(initialLibrary.currentSong);
    setCurrentSongId(initialLibrary.currentSong.id);
  }, [initialLibrary]);

  const findNoteLocation = useCallback(
    (noteId: string): NoteLocation | null => {
      for (let mi = 0; mi < currentSong.measures.length; mi++) {
        const m = currentSong.measures[mi];
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
    [currentSong]
  );

  const getSelectedNote = useCallback((): NoteEntry | null => {
    if (!selectedNoteId) return null;
    const loc = findNoteLocation(selectedNoteId);
    if (!loc) return null;
    const notes = getMeasureVoice(
      currentSong.measures[loc.measureIdx],
      loc.clef,
      loc.voiceIdx,
    );
    return notes[loc.noteIdx];
  }, [selectedNoteId, findNoteLocation, currentSong]);

  const updateSong = useCallback(
    (updater: (song: Song) => Song) => {
      const next = updater(currentSong);
      if (next === currentSong) return;

      const updatedSong = { ...next, updatedAt: Date.now() };
      setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), currentSong]);
      setRedoStack([]);
      setCurrentSong(updatedSong);
      saveSong(updatedSong);
      setSongs(loadSongs());
    },
    [currentSong]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previousSong = { ...undoStack[undoStack.length - 1], updatedAt: Date.now() };
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), currentSong]);
    setCurrentSong(previousSong);
    saveSong(previousSong);
    setSongs(loadSongs());
  }, [currentSong, undoStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextSong = { ...redoStack[redoStack.length - 1], updatedAt: Date.now() };
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), currentSong]);
    setCurrentSong(nextSong);
    saveSong(nextSong);
    setSongs(loadSongs());
  }, [currentSong, redoStack]);

  const modifySelectedNote = useCallback(
    (modifier: (note: NoteEntry) => NoteEntry) => {
      if (!selectedNoteId) return;
      const loc = findNoteLocation(selectedNoteId);
      if (!loc) return;
      const notes = getMeasureVoice(
        currentSong.measures[loc.measureIdx],
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
    [selectedNoteId, findNoteLocation, currentSong, updateSong]
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
          currentSong,
          selectedNoteId,
          new Set(highlightedNoteIds),
          container.clientWidth - 40,
          selectedBarTarget,
        );
        noteMapRef.current = result.noteElements;
        measureRegionsRef.current = result.measureRegions;
      });
    };

    drawScore();
    const resizeObserver = new ResizeObserver(drawScore);
    resizeObserver.observe(container);
    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [currentSong, selectedNoteId, highlightedNoteIds, selectedBarTarget]);

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
    const inset = 5;
    const x = referenceRegion.x + inset
      + Math.max(0, Math.min(1, progress)) * (referenceRegion.width - inset * 2);
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
      if (cursor) drawPlaybackCursor(cursor.measureIdx, cursor.progress);
      if (playState === 'playing') {
        playbackAnimationRef.current = requestAnimationFrame(tick);
      }
    };
    tick();
    return () => {
      if (playbackAnimationRef.current !== null) {
        cancelAnimationFrame(playbackAnimationRef.current);
        playbackAnimationRef.current = null;
      }
    };
  }, [playState, clearPlaybackCursor, drawPlaybackCursor]);

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
  }, [currentSong.measures.length, selectedBarTarget]);

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
      currentSong.measures[clickedLocation.measureIdx],
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
      currentSong.measures[startLocation.measureIdx],
      startLocation.clef,
      startLocation.voiceIdx,
    )[startLocation.noteIdx];
    const shouldRemove = startNote.slurToNoteId === endId;
    const defaultSlurPlacement = startLocation.voiceIdx > 0
      ? 'below'
      : startLocation.clef === 'treble' || currentSong.staffLayout === 'bass-only'
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
  }, [slurToolActive, pendingSlurStartId, findNoteLocation, currentSong, updateSong]);

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
    const voices = getMeasureVoices(currentSong.measures[region.measureIdx], region.clef);
    const voiceIdx = voices.length > 1 && y > region.voiceSplitY ? 1 : 0;
    return { measureIdx: region.measureIdx, clef: region.clef, voiceIdx };
  }, [currentSong]);

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
          selectedInfo && selected && !selected.isRest &&
          Math.abs(point.x - selectedInfo.x) <= 14 &&
          Math.abs(point.y - selectedInfo.y) >= 7 &&
          Math.abs(point.y - selectedInfo.y) <= 60
        ) {
          const region = measureRegionsRef.current.find((candidate) => (
            candidate.measureIdx === selectedInfo.measureIdx && candidate.clef === selectedInfo.clef
          ));
          if (region) {
            const displayClef = currentSong.staffClefs?.[selectedInfo.clef] ?? selectedInfo.clef;
            const key = staffYToKey(point.y, region.voiceSplitY - 20, displayClef);
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
          const voiceLabel = currentSong.voiceLabels?.[target.clef]?.[target.voiceIdx]
            ?? (target.voiceIdx === 0 ? 'upper voice' : 'lower voice');
          setEditorMessage(`Bar ${target.measureIdx + 1}, ${voiceLabel} selected. Click a piano key, or right-click the bar for Add note(s).`);
        } else {
          setEditorMessage(null);
        }
      }
    },
    [
      composerRequest,
      currentSong,
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
    const voiceLabel = currentSong.voiceLabels?.[target.clef]?.[target.voiceIdx]
      ?? (target.voiceIdx === 0 ? 'upper voice' : 'lower voice');
    setEditorMessage(`Adding to bar ${target.measureIdx + 1}, ${voiceLabel}: piano keys update the bar live. Press Enter to finish or Cancel to restore it.`);
  }, [currentSong]);

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
    const song = currentSongRef.current;
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
      const previewSong = { ...song, measures };
      currentSongRef.current = previewSong;
      setCurrentSong(previewSong);
      setSelectedNoteId(null);
      return true;
    }

    const normalized = normalizePianoKeys(keys);
    const noteId = provisionalId ?? createId();
    const existing = provisionalIndex >= 0 ? notes[provisionalIndex] : null;
    const provisionalNote: NoteEntry = {
      ...(existing ?? { id: noteId, duration: selectedDuration }),
      keys: normalized.keys,
      accidentals: normalized.accidentals,
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
    const previewSong = { ...song, measures };
    provisionalNoteIdRef.current = noteId;
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
      setUndoStack((stack) => [...stack.slice(-(MAX_HISTORY - 1)), baseSong]);
      setRedoStack([]);
      currentSongRef.current = committedSong;
      setCurrentSong(committedSong);
      saveSong(committedSong);
      setSongs(loadSongs());
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

  const transposeSelectedNote = useCallback((direction: number) => {
    modifySelectedNote((note) => transposeNoteBySteps(note, direction));
  }, [modifySelectedNote]);

  const navigateNote = useCallback((direction: number) => {
    if (!selectedNoteId) return;
    const loc = findNoteLocation(selectedNoteId);
    if (!loc) return;
    const notes = getMeasureVoice(
      currentSong.measures[loc.measureIdx],
      loc.clef,
      loc.voiceIdx,
    );
    const newIdx = loc.noteIdx + direction;

    if (newIdx >= 0 && newIdx < notes.length) {
      setSelectedNoteId(notes[newIdx].id);
    } else if (newIdx < 0 && loc.measureIdx > 0) {
      const prevNotes = getMeasureVoice(
        currentSong.measures[loc.measureIdx - 1],
        loc.clef,
        loc.voiceIdx,
      );
      if (prevNotes.length > 0) setSelectedNoteId(prevNotes[prevNotes.length - 1].id);
    } else if (newIdx >= notes.length && loc.measureIdx < currentSong.measures.length - 1) {
      const nextNotes = getMeasureVoice(
        currentSong.measures[loc.measureIdx + 1],
        loc.clef,
        loc.voiceIdx,
      );
      if (nextNotes.length > 0) setSelectedNoteId(nextNotes[0].id);
    }
  }, [selectedNoteId, findNoteLocation, currentSong]);

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
      await playbackEngine.play(currentSong, instrumentSound);
      if (playbackEngine.getState() === 'playing') setPlayState('playing');
    } catch {
      playbackEngine.stop();
      setPlayState('stopped');
      setHighlightedNoteIds([]);
      setActivePlaybackKeys([]);
      setEditorMessage('That sound could not be prepared. Try another sound or check your connection.');
    }
  }, [currentSong, instrumentSound, playState]);

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

  const handleInstrumentSoundChange = useCallback((sound: InstrumentSound) => {
    handleStop();
    setInstrumentSound(sound);
    localStorage.setItem(INSTRUMENT_STORAGE_KEY, sound);
    void playbackEngine.prepare(sound).catch(() => {
      setEditorMessage('That sound could not be prepared. Try another sound or check your connection.');
    });
  }, [handleStop]);

  useEffect(() => {
    // Start fetching/constructing the chosen instrument before the first Play
    // click. The browser audio context is still resumed only after interaction.
    void playbackEngine.prepare(instrumentSound).catch(() => {
      // Play reports an actionable error if preparation still fails later.
    });
  }, [instrumentSound]);

  useEffect(() => () => playbackEngine.stop(), []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      if (composerRequest) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setScoreContextMenu(null);
          cancelComposerSession();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); handleUndo(); return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault(); handleRedo(); return;
      }

      switch (e.key) {
        case 'Escape':
          setSlurToolActive(false);
          setPendingSlurStartId(null);
          setScoreContextMenu(null);
          setEditorMessage(null);
          break;
        case '1': setSelectedDuration('w'); modifySelectedNote((n) => ({ ...n, duration: 'w' })); break;
        case '2': setSelectedDuration('h'); modifySelectedNote((n) => ({ ...n, duration: 'h' })); break;
        case '3': setSelectedDuration('q'); modifySelectedNote((n) => ({ ...n, duration: 'q' })); break;
        case '4': setSelectedDuration('8'); modifySelectedNote((n) => ({ ...n, duration: '8' })); break;
        case '5': setSelectedDuration('16'); modifySelectedNote((n) => ({ ...n, duration: '16' })); break;
        case 'r': setIsRestMode((v) => !v); break;
        case '.': setIsDotted((v) => !v); break;
        case 't': modifySelectedNote((n) => ({ ...n, tieToNext: !n.tieToNext })); break;
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
  }, [modifySelectedNote, selectedNoteId, handleDeleteNote, navigateNote, transposeSelectedNote, playState, handlePlay, handlePause, handleStop, handleUndo, handleRedo, composerRequest, cancelComposerSession]);

  // Add note with beat validation
  const handleAddNote = (keys: string[], clef: 'treble' | 'bass') => {
    const explicitTarget = composerRequest?.mode === 'add'
      ? composerRequest.target ?? selectedBarTarget
      : selectedBarTarget;
    let measureIdx = explicitTarget?.measureIdx ?? 0;
    let insertIdx = -1;
    let voiceIdx = explicitTarget?.voiceIdx ?? 0;
    let targetClef = explicitTarget?.clef ?? clef;
    let shouldAppendMeasure = false;

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

    const normalized = normalizePianoKeys(keys);
    const newNote: NoteEntry = {
      id: createId(),
      keys: isRestMode ? (targetClef === 'treble' ? ['b/4'] : ['d/3']) : normalized.keys,
      duration: selectedDuration,
      isRest: isRestMode,
      dotted: isDotted || undefined,
      accidentals: !isRestMode ? normalized.accidentals : undefined,
    };

    const newNoteBeats = getNoteBeatValue(newNote);
    const capacity = getMeasureCapacity(currentSong.timeSignature);
    if (newNoteBeats > capacity) {
      setEditorMessage(`A ${isDotted ? 'dotted ' : ''}${selectedDuration} note will not fit in this time signature.`);
      return false;
    }

    const notesInTarget = getMeasureVoice(
      currentSong.measures[measureIdx],
      targetClef,
      voiceIdx,
    );
    if (getMeasureBeatCount(notesInTarget) + newNoteBeats > capacity) {
      if (explicitTarget) {
        setEditorMessage(`Bar ${measureIdx + 1} does not have room for that ${isRestMode ? 'rest' : keys.length > 1 ? 'chord' : 'note'}.`);
        return false;
      }
      let nextMeasureIdx = measureIdx + 1;
      while (nextMeasureIdx < currentSong.measures.length) {
        const nextNotes = getMeasureVoice(
          currentSong.measures[nextMeasureIdx],
          targetClef,
          voiceIdx,
        );
        if (getMeasureBeatCount(nextNotes) + newNoteBeats <= capacity) break;
        nextMeasureIdx++;
      }
      measureIdx = nextMeasureIdx;
      insertIdx = -1;
      shouldAppendMeasure = measureIdx === currentSong.measures.length;
    }

    updateSong((song) => {
      const measures = song.measures.map((measure) => ({ ...measure }));
      if (shouldAppendMeasure) measures.push(createDefaultMeasure());
      const newSong = { ...song, measures };
      const notes = [...getMeasureVoice(newSong.measures[measureIdx], targetClef, voiceIdx)];
      if (insertIdx >= 0) notes.splice(insertIdx, 0, newNote);
      else notes.push(newNote);
      newSong.measures[measureIdx] = replaceMeasureVoice(
        newSong.measures[measureIdx],
        targetClef,
        voiceIdx,
        notes,
      );
      return newSong;
    });
    setSelectedNoteId(newNote.id);
    if (explicitTarget) setSelectedBarTarget({ measureIdx, clef: targetClef, voiceIdx });
    setEditorMessage(null);
    return true;
  };

  const handleDeleteMeasure = () => {
    if (currentSong.measures.length <= 1) return;
    const loc = selectedNoteId ? findNoteLocation(selectedNoteId) : null;
    const measureIdx = loc?.measureIdx
      ?? selectedBarTarget?.measureIdx
      ?? currentSong.measures.length - 1;
    updateSong((song) => {
      const removedMeasure = song.measures[measureIdx];
      const removedNoteIds = new Set(getMeasureNoteIds(removedMeasure));
      return {
        ...song,
        measures: song.measures
          .filter((_, index) => index !== measureIdx)
          .map((measure) => mapMeasureNotes(measure, (note) => (
              note.slurToNoteId && removedNoteIds.has(note.slurToNoteId)
                ? { ...note, slurToNoteId: undefined }
                : note
            ))),
      };
    });
    setSelectedNoteId(null);
    setSelectedBarTarget(null);
    setComposerRequest(null);
  };

  const handleAddMeasure = () => {
    const measureIdx = currentSong.measures.length;
    const clef = currentSong.staffLayout === 'bass-only'
      ? 'bass'
      : selectedBarTarget?.clef ?? 'treble';
    updateSong((song) => ({
      ...song, measures: [...song.measures, createDefaultMeasure()],
    }));
    setSelectedNoteId(null);
    setSelectedBarTarget({ measureIdx, clef, voiceIdx: 0 });
    setComposerRequest(null);
    setEditorMessage(`Bar ${measureIdx + 1} selected. Click a piano key to add directly to it, or right-click it for Add note(s).`);
  };

  const handleAccidental = (acc: Accidental) => {
    modifySelectedNote((note) => {
      const current = note.accidentals?.[0];
      return { ...note, accidentals: current === acc ? undefined : note.keys.map(() => acc) };
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
    updateSong((song) => {
      const newSong = { ...song, measures: song.measures.map((m) => ({ ...m })) };
      newSong.measures[measureIdx] = { ...newSong.measures[measureIdx], repeatStart: !newSong.measures[measureIdx].repeatStart };
      return newSong;
    });
  };

  const handleRepeatEnd = () => {
    const loc = selectedNoteId ? findNoteLocation(selectedNoteId) : null;
    const measureIdx = loc?.measureIdx
      ?? selectedBarTarget?.measureIdx
      ?? currentSong.measures.length - 1;
    updateSong((song) => {
      const newSong = { ...song, measures: song.measures.map((m) => ({ ...m })) };
      newSong.measures[measureIdx] = { ...newSong.measures[measureIdx], repeatEnd: !newSong.measures[measureIdx].repeatEnd };
      return newSong;
    });
  };

  const handleNewSong = () => {
    handleStop();
    const newSong = createDefaultSong();
    saveSong(newSong);
    setCurrentSongId(newSong.id);
    setCurrentSong(newSong);
    setSongs(loadSongs());
    setSelectedNoteId(null);
    setSelectedBarTarget(null);
    setScoreContextMenu(null);
    setComposerRequest(null);
    setSlurToolActive(false);
    setPendingSlurStartId(null);
    setEditorMessage(null);
    setUndoStack([]); setRedoStack([]);
  };

  const handleSelectSong = (id: string) => {
    const song = songs.find((s) => s.id === id);
    if (song) {
      handleStop();
      setCurrentSong(song);
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
    if (!song || !window.confirm(`Delete “${song.title || 'Untitled'}”? This cannot be undone.`)) return;
    if (id === currentSong.id) handleStop();
    deleteStoredSong(id);
    const remaining = loadSongs();
    setSongs(remaining);
    if (id === currentSong.id) {
      if (remaining.length > 0) { setCurrentSong(remaining[0]); setCurrentSongId(remaining[0].id); }
      else handleNewSong();
      setSelectedNoteId(null);
      setSelectedBarTarget(null);
      setScoreContextMenu(null);
      setComposerRequest(null);
      setSlurToolActive(false);
      setPendingSlurStartId(null);
    }
  };

  const handleExport = () => exportSongToJson(currentSong);

  const handleImport = async (file: File) => {
    try {
      const importedSong = await importSongFromJson(file);
      const now = Date.now();
      const song = { ...importedSong, id: createId(), createdAt: now, updatedAt: now };
      handleStop();
      saveSong(song);
      setCurrentSong(song);
      setCurrentSongId(song.id);
      setSongs(loadSongs());
      setSelectedNoteId(null);
      setSelectedBarTarget(null);
      setScoreContextMenu(null);
      setComposerRequest(null);
      setSlurToolActive(false);
      setPendingSlurStartId(null);
      setEditorMessage(null);
      setUndoStack([]); setRedoStack([]);
    } catch (err) {
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

  const selectedNote = getSelectedNote();
  const selectedNoteLabel = selectedNote?.isRest
    ? 'Rest'
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
          currentSong.measures[selectedLoc.measureIdx],
          selectedLoc.clef,
          selectedLoc.voiceIdx,
        )
      )
    : 0;
  const capacity = getMeasureCapacity(currentSong.timeSignature);
  const composerLabel = composerRequest?.mode === 'edit'
    ? `Editing ${selectedNote && selectedNote.keys.length > 1 ? 'chord' : 'note'}`
    : composerRequest?.target
      ? `Bar ${composerRequest.target.measureIdx + 1} · ${currentSong.voiceLabels?.[composerRequest.target.clef]?.[composerRequest.target.voiceIdx] ?? (composerRequest.target.voiceIdx === 0 ? 'upper voice' : 'lower voice')}`
      : '';

  return (
    <div className="app">
      <PlaybackBar
        songId={currentSong.id}
        playState={playState}
        tempo={currentSong.tempo}
        keySignature={currentSong.keySignature}
        instrumentSound={instrumentSound}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onTempoChange={(tempo) => updateSong((song) => song.tempo === tempo ? song : { ...song, tempo })}
        onKeySignatureChange={(keySignature) => updateSong((song) => (
          song.keySignature === keySignature ? song : { ...song, keySignature }
        ))}
        onInstrumentSoundChange={handleInstrumentSoundChange}
        songTitle={currentSong.title}
        onTitleChange={(title) => updateSong((song) => song.title === title ? song : { ...song, title })}
        currentMeasure={currentPlayMeasure}
        totalMeasures={currentSong.measures.length}
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
        onRestMove={(direction) => modifySelectedNote((note) => {
          if (!note.isRest) return note;
          const restOffset = Math.max(-6, Math.min(6, (note.restOffset ?? 0) + direction * 0.5));
          return { ...note, restOffset: restOffset || undefined };
        })}
        onRestReset={() => modifySelectedNote((note) => ({ ...note, restOffset: undefined }))}
        onAccidental={handleAccidental}
        onDynamic={handleDynamic}
        onArticulation={handleArticulation}
        onTie={() => modifySelectedNote((n) => ({ ...n, tieToNext: !n.tieToNext }))}
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
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        canDeleteMeasure={currentSong.measures.length > 1}
        selectedNote={selectedNote}
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
            aria-label="Interactive sheet music. Click a bar to select it, or right-click for editing actions."
          />
          {scoreContextMenu && (
            <div
              className="score-context-menu"
              style={{ left: scoreContextMenu.x, top: scoreContextMenu.y }}
              role="menu"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {scoreContextMenu.kind === 'measure' ? (
                <>
                  <div className="score-context-title">
                    Bar {scoreContextMenu.target.measureIdx + 1}
                    <span>
                      {currentSong.voiceLabels?.[scoreContextMenu.target.clef]?.[scoreContextMenu.target.voiceIdx]
                        ?? (scoreContextMenu.target.voiceIdx === 0 ? 'Upper voice' : 'Lower voice')}
                    </span>
                  </div>
                  <button type="button" role="menuitem" onClick={() => beginAddingNotes(scoreContextMenu.target)}>
                    <span className="context-menu-icon">♪</span>
                    Add note(s)
                    <kbd>Enter</kbd>
                  </button>
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
                {currentSong.voiceLabels?.[selectedBarTarget.clef]?.[selectedBarTarget.voiceIdx]
                  ?? (selectedBarTarget.voiceIdx === 0 ? 'Upper voice' : 'Lower voice')}
                {' '}&middot;{' '}Piano input will be added here
              </span>
            ) : (
              <span className="status-hint">Select a note to edit it, or use the piano below to begin in bar 1</span>
            )}
            <span className="status-shortcuts">
              {composerRequest?.mode === 'add' ? (
                <>Click a piano key again to remove it &middot; Enter: finish &middot; Escape: cancel</>
              ) : selectedNote ? (
                <>{selectedNote.isRest ? '↑/↓: move rest' : 'Drag: move · click above/below: add tone'} &middot; Right-click: edit/delete &middot; ←/→: navigate</>
              ) : selectedBarTarget ? (
                <>Right-click bar: add note(s) &middot; Click piano: add note</>
              ) : (
                <>Right-click a bar for actions &middot; Space: play/pause &middot; Cmd+Z: undo</>
              )}
            </span>
          </div>
        </div>
      </div>
      <NoteInput
        key={composerRequest ? `composer-${composerRequest.id}` : selectedNote?.id ?? 'no-selection'}
        onAddNote={handleAddNote}
        selectedNote={selectedNote}
        session={composerRequest ? { mode: composerRequest.mode, label: composerLabel } : null}
        onPreviewKeysChange={previewComposerKeys}
        onSessionCommit={commitComposerSession}
        onSessionCancel={cancelComposerSession}
        activePlaybackKeys={activePlaybackKeys}
        onUpdateSelectedKeys={(keys) => {
          const normalized = normalizePianoKeys(keys);
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
