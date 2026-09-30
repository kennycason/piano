import type { Song, Dynamic, NoteEntry, StaffClef } from '../models/song';
import {
  getKeySignatureAccidental,
  getMeasureCapacity,
  getMeasureVoices,
} from '../models/song';

const dynamicToVelocity: Record<Dynamic, number> = {
  pp: 0.2,
  p: 0.35,
  mp: 0.5,
  mf: 0.65,
  f: 0.8,
  ff: 0.95,
};

export type InstrumentSound = 'grand-piano' | 'electric-keys' | 'warm-pad' | 'music-box';

export const INSTRUMENT_OPTIONS: ReadonlyArray<{ value: InstrumentSound; label: string }> = [
  { value: 'grand-piano', label: 'Grand Piano' },
  { value: 'electric-keys', label: 'Electric Keys' },
  { value: 'warm-pad', label: 'Warm Pad' },
  { value: 'music-box', label: 'Music Box' },
];

export interface SynthControls {
  volume: number;
  tone: number;
  echo: number;
  sustain: number;
}

export const DEFAULT_SYNTH_CONTROLS: SynthControls = {
  volume: 0.82,
  tone: 0.72,
  echo: 0.08,
  sustain: 0.48,
};

export interface PlaybackCursorState {
  measureIdx: number;
  progress: number;
}

type ToneModule = typeof import('tone');
type NotesCallback = (measureIdx: number, noteIds: string[]) => void;
type ActiveKeysCallback = (keys: string[]) => void;
type StopCallback = () => void;

interface PlaybackOutput {
  triggerAttackRelease(
    notes: string | string[],
    duration: number,
    time?: number,
    velocity?: number,
  ): unknown;
  releaseAll(time?: number): unknown;
}

interface VisualStart {
  noteId: string;
  measureIdx: number;
  pianoKeys: string[];
}

interface VisualEvent {
  starts: VisualStart[];
  stops: string[];
}

function vexKeyToNote(key: string, accidental: string | null | undefined, keySignature: string): string {
  const [noteName, octave] = key.split('/');
  const embeddedAccidental = noteName.slice(1);
  const signatureAccidental = getKeySignatureAccidental(keySignature, noteName);
  const effectiveAccidental = accidental === 'n'
    ? ''
    : (accidental ?? embeddedAccidental) || signatureAccidental || '';
  return `${noteName[0].toUpperCase()}${effectiveAccidental}${octave}`;
}

function toneNoteToPianoKey(note: string): string {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
  if (!match) return note.toLowerCase().replace(/(-?\d+)$/, '/$1');
  const [, letter, accidental, octaveText] = match;
  const pitchClasses: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  };
  const sharpNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const accidentalOffset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  const midi = (Number(octaveText) + 1) * 12 + pitchClasses[letter] + accidentalOffset;
  const normalizedPitch = ((midi % 12) + 12) % 12;
  return `${sharpNames[normalizedPitch]}/${Math.floor(midi / 12) - 1}`;
}

function durationToSeconds(duration: string, tempo: number, dotted?: boolean): number {
  const beatDuration = 60 / tempo;
  const map: Record<string, number> = {
    w: 4,
    h: 2,
    q: 1,
    '8': 0.5,
    '16': 0.25,
  };
  let durationInSeconds = (map[duration] || 1) * beatDuration;
  if (dotted) durationInSeconds *= 1.5;
  return durationInSeconds;
}

function noteKeysMatch(a: NoteEntry, b: NoteEntry): boolean {
  return a.keys.length === b.keys.length && a.keys.every((key, index) => key === b.keys[index]);
}

function getPlaybackOrder(song: Song): number[] {
  const order: number[] = [];
  let repeatStart = 0;

  for (let measureIndex = 0; measureIndex < song.measures.length; measureIndex++) {
    const measure = song.measures[measureIndex];
    if (measure.repeatStart) repeatStart = measureIndex;
    order.push(measureIndex);

    if (measure.repeatEnd) {
      for (let repeatedIndex = repeatStart; repeatedIndex <= measureIndex; repeatedIndex++) {
        order.push(repeatedIndex);
      }
      repeatStart = measureIndex + 1;
    }
  }

  return order;
}

export class PlaybackEngine {
  private tone: ToneModule | null = null;
  private tonePromise: Promise<ToneModule> | null = null;
  private sampler: import('tone').Sampler | null = null;
  private samplerPromise: Promise<PlaybackOutput> | null = null;
  private synths = new Map<Exclude<InstrumentSound, 'grand-piano'>, PlaybackOutput>();
  private masterFilter: import('tone').Filter | null = null;
  private masterDelay: import('tone').FeedbackDelay | null = null;
  private masterVolume: import('tone').Volume | null = null;
  private controls: SynthControls = { ...DEFAULT_SYNTH_CONTROLS };
  private activeOutput: PlaybackOutput | null = null;
  private state: 'stopped' | 'playing' | 'paused' = 'stopped';
  private loopEnabled = false;
  private loopEnd = 0;
  private instrumentRequest = 0;
  private generation = 0;
  private cursorSegments: Array<{
    measureIdx: number;
    startTime: number;
    endTime: number;
  }> = [];
  private onNotesCallback?: NotesCallback;
  private onActiveKeysCallback?: ActiveKeysCallback;
  private onStopCallback?: StopCallback;

  private async getTone(): Promise<ToneModule> {
    if (!this.tonePromise) {
      this.tonePromise = import('tone').then((tone) => {
        this.tone = tone;
        return tone;
      });
    }
    return this.tonePromise;
  }

  private ensureMasterChain(Tone: ToneModule): import('tone').Filter {
    if (!this.masterFilter || !this.masterDelay || !this.masterVolume) {
      this.masterVolume = new Tone.Volume().toDestination();
      this.masterDelay = new Tone.FeedbackDelay({
        delayTime: 0.18,
        feedback: 0.2,
        wet: 0,
      }).connect(this.masterVolume);
      this.masterFilter = new Tone.Filter({
        frequency: 12_000,
        type: 'lowpass',
        rolloff: -12,
      }).connect(this.masterDelay);
      this.applySynthControls();
    }
    return this.masterFilter;
  }

  private applySynthControls(): void {
    const volume = Math.max(0, Math.min(1, this.controls.volume));
    const tone = Math.max(0, Math.min(1, this.controls.tone));
    const echo = Math.max(0, Math.min(1, this.controls.echo));
    if (this.masterVolume) {
      this.masterVolume.volume.value = volume <= 0.001 ? -60 : 20 * Math.log10(volume);
    }
    if (this.masterFilter) {
      this.masterFilter.frequency.value = 550 + tone * tone * 14_500;
    }
    if (this.masterDelay) {
      this.masterDelay.wet.value = echo * 0.55;
      this.masterDelay.feedback.value = 0.12 + echo * 0.32;
    }
  }

  private ensureSampler(Tone: ToneModule): Promise<PlaybackOutput> {
    if (!this.samplerPromise) {
      const samplerPromise = new Promise<PlaybackOutput>((resolve, reject) => {
        this.sampler = new Tone.Sampler({
          urls: {
            A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
            A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
            A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
            A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
            A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
            A5: 'A5.mp3', C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
            A6: 'A6.mp3', C7: 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
            A7: 'A7.mp3', C8: 'C8.mp3',
          },
          release: 1,
          baseUrl: 'https://tonejs.github.io/audio/salamander/',
          onload: () => resolve(this.sampler as unknown as PlaybackOutput),
          onerror: (error) => reject(error),
        }).connect(this.ensureMasterChain(Tone));
      }).catch((error: unknown) => {
        this.samplerPromise = null;
        this.sampler?.dispose();
        this.sampler = null;
        throw error;
      });
      this.samplerPromise = samplerPromise;
    }
    return this.samplerPromise;
  }

  private ensureSynth(
    Tone: ToneModule,
    sound: Exclude<InstrumentSound, 'grand-piano'>,
  ): PlaybackOutput {
    const existing = this.synths.get(sound);
    if (existing) return existing;

    const settings = sound === 'electric-keys'
      ? {
          oscillator: { type: 'triangle' as const },
          envelope: { attack: 0.008, decay: 0.35, sustain: 0.28, release: 1.1 },
        }
      : sound === 'warm-pad'
        ? {
            oscillator: { type: 'sine' as const },
            envelope: { attack: 0.18, decay: 0.45, sustain: 0.72, release: 1.8 },
          }
        : {
            oscillator: { type: 'triangle8' as const },
            envelope: { attack: 0.002, decay: 0.7, sustain: 0.04, release: 1.4 },
          };
    const synth = new Tone.PolySynth(Tone.Synth, settings).connect(this.ensureMasterChain(Tone));
    synth.volume.value = sound === 'warm-pad' ? -8 : sound === 'music-box' ? -5 : -6;
    const output = synth as unknown as PlaybackOutput;
    this.synths.set(sound, output);
    return output;
  }

  private async ensureInstrument(sound: InstrumentSound): Promise<PlaybackOutput> {
    const Tone = await this.getTone();
    return sound === 'grand-piano'
      ? this.ensureSampler(Tone)
      : this.ensureSynth(Tone, sound);
  }

  async prepare(sound: InstrumentSound): Promise<void> {
    await this.ensureInstrument(sound);
  }

  setSynthControls(controls: SynthControls): void {
    this.controls = {
      volume: Math.max(0, Math.min(1, controls.volume)),
      tone: Math.max(0, Math.min(1, controls.tone)),
      echo: Math.max(0, Math.min(1, controls.echo)),
      sustain: Math.max(0, Math.min(1, controls.sustain)),
    };
    this.applySynthControls();
  }

  async selectInstrument(sound: InstrumentSound): Promise<void> {
    const request = ++this.instrumentRequest;
    const output = await this.ensureInstrument(sound);
    if (request !== this.instrumentRequest) return;
    if (this.activeOutput !== output && this.state !== 'stopped') {
      this.activeOutput?.releaseAll();
      this.onActiveKeysCallback?.([]);
    }
    this.activeOutput = output;
  }

  async previewNotes(keys: string[], sound: InstrumentSound): Promise<void> {
    if (keys.length === 0) return;
    const Tone = await this.getTone();
    const output = await this.ensureInstrument(sound);
    await Tone.start();
    const toneNotes = keys.map((key) => vexKeyToNote(key, null, 'C'));
    const duration = 0.16 + this.controls.sustain * 1.35;
    output.triggerAttackRelease(toneNotes, duration, Tone.now(), 0.72);
  }

  onNotes(callback: NotesCallback) { this.onNotesCallback = callback; }
  onActiveKeys(callback: ActiveKeysCallback) { this.onActiveKeysCallback = callback; }
  onStopped(callback: StopCallback) { this.onStopCallback = callback; }

  async play(
    song: Song,
    sound: InstrumentSound,
    startMeasure = 0,
    loop = false,
  ): Promise<void> {
    if (this.state !== 'stopped') this.stop();
    const playGeneration = ++this.generation;
    const Tone = await this.getTone();
    const output = await this.ensureInstrument(sound);
    await Tone.start();
    if (playGeneration !== this.generation) return;

    this.activeOutput = output;
    this.state = 'playing';
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    transport.loop = false;
    transport.seconds = 0;
    this.loopEnabled = loop;

    let time = 0;
    const currentVelocity = new Map<string, number>();
    const pedalOn = new Map<string, boolean>();
    const playbackOrder = getPlaybackOrder(song).filter((measureIndex) => measureIndex >= startMeasure);
    const measureDuration = getMeasureCapacity(song.timeSignature) * (60 / song.tempo);
    const visualEvents = new Map<number, VisualEvent>();
    const activeKeyCounts = new Map<string, number>();
    this.cursorSegments = [];

    const eventAt = (eventTime: number): VisualEvent => {
      const key = Math.round(eventTime * 1_000_000);
      const existing = visualEvents.get(key);
      if (existing) return existing;
      const event = { starts: [], stops: [] };
      visualEvents.set(key, event);
      return event;
    };

    for (const measureIndex of playbackOrder) {
      const measure = song.measures[measureIndex];
      this.cursorSegments.push({
        measureIdx: measureIndex,
        startTime: time,
        endTime: time + measureDuration,
      });

      for (const clef of ['treble', 'bass'] as StaffClef[]) {
        const voices = getMeasureVoices(measure, clef);
        for (let voiceIdx = 0; voiceIdx < voices.length; voiceIdx++) {
          const notes = voices[voiceIdx];
          const voiceKey = `${clef}:${voiceIdx}`;
          let voiceTime = time;
          if (!currentVelocity.has(voiceKey)) currentVelocity.set(voiceKey, 0.65);
          if (!pedalOn.has(voiceKey)) pedalOn.set(voiceKey, false);

          for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
            const note = notes[noteIndex];
            const duration = durationToSeconds(note.duration, song.tempo, note.dotted);
            if (note.dynamic) currentVelocity.set(voiceKey, dynamicToVelocity[note.dynamic]);
            if (note.pedalStart) pedalOn.set(voiceKey, true);

            let soundingDuration = duration;
            let tieIndex = noteIndex;
            while (notes[tieIndex]?.tieToNext && notes[tieIndex + 1] && noteKeysMatch(note, notes[tieIndex + 1])) {
              tieIndex++;
              soundingDuration += durationToSeconds(notes[tieIndex].duration, song.tempo, notes[tieIndex].dotted);
            }

            const isTieContinuation = noteIndex > 0
              && notes[noteIndex - 1].tieToNext
              && noteKeysMatch(notes[noteIndex - 1], note);
            const toneNotes = note.keys.map((key, index) => (
              vexKeyToNote(key, note.accidentals?.[index], song.keySignature)
            ));
            const pianoKeys = toneNotes.map(toneNoteToPianoKey);
            const hasStaccato = note.articulations?.includes('staccato');
            const hasTenuto = note.articulations?.includes('tenuto');
            const hasFermata = note.articulations?.includes('fermata');
            const hasAccent = note.articulations?.includes('accent');
            const durationFactor = hasStaccato
              ? 0.3
              : hasFermata
                ? 1.5
                : hasTenuto
                  ? 0.98
                  : pedalOn.get(voiceKey)
                    ? 1.2
                    : 0.9;
            const actualDuration = soundingDuration * durationFactor;
            const velocity = Math.min(
              1,
              (currentVelocity.get(voiceKey) ?? 0.65) * (hasAccent ? 1.18 : 1),
            );

            eventAt(voiceTime).starts.push({
              noteId: note.id,
              measureIdx: measureIndex,
              pianoKeys: !note.isRest && !isTieContinuation ? pianoKeys : [],
            });
            if (!note.isRest && !isTieContinuation) {
              eventAt(voiceTime + actualDuration).stops.push(...pianoKeys);
              transport.schedule((scheduledTime) => {
                if (this.state !== 'playing') return;
                this.activeOutput?.triggerAttackRelease(
                  toneNotes,
                  actualDuration,
                  scheduledTime,
                  velocity,
                );
              }, voiceTime);
            }

            if (note.pedalEnd) pedalOn.set(voiceKey, false);
            voiceTime += duration;
          }
        }
      }

      time += measureDuration;
    }

    [...visualEvents.entries()]
      .sort(([a], [b]) => a - b)
      .forEach(([eventKey, event]) => {
        const eventTime = eventKey / 1_000_000;
        transport.schedule((scheduledTime) => {
          if (this.state !== 'playing') return;
          Tone.getDraw().schedule(() => {
            if (this.state !== 'playing' || playGeneration !== this.generation) return;
            for (const key of event.stops) {
              const count = (activeKeyCounts.get(key) ?? 0) - 1;
              if (count > 0) activeKeyCounts.set(key, count);
              else activeKeyCounts.delete(key);
            }
            for (const start of event.starts) {
              for (const key of start.pianoKeys) {
                activeKeyCounts.set(key, (activeKeyCounts.get(key) ?? 0) + 1);
              }
            }
            if (event.stops.length > 0 || event.starts.some((start) => start.pianoKeys.length > 0)) {
              this.onActiveKeysCallback?.([...activeKeyCounts.keys()]);
            }
            if (event.starts.length > 0) {
              this.onNotesCallback?.(
                event.starts[0].measureIdx,
                event.starts.map((start) => start.noteId),
              );
            }
          }, scheduledTime);
        }, eventTime);
      });

    transport.schedule((scheduledTime) => {
      Tone.getDraw().schedule(() => {
        if (playGeneration !== this.generation) return;
        this.stop();
        this.onStopCallback?.();
      }, scheduledTime);
    }, time + 0.08);

    this.loopEnd = time;
    transport.loopStart = 0;
    transport.loopEnd = time;
    transport.loop = loop;

    // Reset visual key accounting immediately before a new loop begins. Notes
    // scheduled at beat zero then establish the next cycle's active keys.
    if (time > 0.002) {
      transport.schedule((scheduledTime) => {
        if (!this.loopEnabled) return;
        Tone.getDraw().schedule(() => {
          activeKeyCounts.clear();
          this.onActiveKeysCallback?.([]);
        }, scheduledTime);
      }, time - 0.001);
    }

    // Give the audio graph a short, deterministic lead-in after loading. This
    // avoids asking the first sampled note to sound on the same frame that the
    // browser resumes its audio context.
    transport.start('+0.12');
  }

  pause() {
    if (this.state !== 'playing' || !this.tone) return;
    this.state = 'paused';
    this.tone.getTransport().pause();
    this.activeOutput?.releaseAll();
    this.onActiveKeysCallback?.([]);
  }

  resume() {
    if (this.state !== 'paused' || !this.tone) return;
    this.state = 'playing';
    this.tone.getTransport().start('+0.04');
  }

  setLoop(enabled: boolean): void {
    this.loopEnabled = enabled;
    if (!this.tone || this.loopEnd <= 0) return;
    const transport = this.tone.getTransport();
    transport.loopStart = 0;
    transport.loopEnd = this.loopEnd;
    transport.loop = enabled;
  }

  stop() {
    this.generation++;
    this.state = 'stopped';
    this.tone?.getTransport().stop();
    this.tone?.getTransport().cancel();
    if (this.tone) this.tone.getTransport().loop = false;
    this.activeOutput?.releaseAll();
    this.onActiveKeysCallback?.([]);
    this.cursorSegments = [];
  }

  getCursorState(): PlaybackCursorState | null {
    if (!this.tone || this.cursorSegments.length === 0) return null;
    const seconds = this.tone.getTransport().seconds;
    const segment = this.cursorSegments.find((candidate) => (
      seconds >= candidate.startTime && seconds < candidate.endTime
    )) ?? (seconds < this.cursorSegments[0].startTime ? this.cursorSegments[0] : null);
    if (!segment) return null;
    return {
      measureIdx: segment.measureIdx,
      progress: Math.max(0, Math.min(1, (
        seconds - segment.startTime
      ) / Math.max(0.001, segment.endTime - segment.startTime))),
    };
  }

  getState() { return this.state; }
}

export const playbackEngine = new PlaybackEngine();
