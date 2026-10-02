import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental,
  Dot,
  Articulation,
  StaveTie,
  StaveConnector,
  Annotation,
  Beam,
  Curve,
  BarlineType,
  Stem,
  Modifier,
} from 'vexflow';
import {
  getMeasureAccidentalDisplay,
  getMeasureBeatCount,
  getMeasureCapacity,
  getMeasureVoices,
  getNoteBeatValue,
  getTieIndexes,
} from '../models/song';
import type { EditableScore, NoteEntry, SlurPlacement, StaffClef } from '../models/song';

const DEFAULT_STAVE_WIDTH = 280;
const MIN_STAVE_WIDTH = 240;
const START_X = 40;
const HEADER_HEIGHT = 90;
const TITLE_BASELINE = 46;
const TEMPO_BASELINE = 75;
const TREBLE_OFFSET = 18;
const BASS_OFFSET = 128;
const ROW_HEIGHT = 250;
const SINGLE_STAFF_OFFSET = 46;
const SINGLE_ROW_HEIGHT = 170;
const MAX_MEASURES_PER_ROW = 4;
const UPPER_VOICE_LABEL_OFFSET = 28;
const LOWER_VOICE_LABEL_OFFSET = 96;

export function getRenderedVoiceLabel(label: string | undefined, trackName: string): string | undefined {
  const trimmedLabel = label?.trim();
  if (!trimmedLabel) return undefined;
  const normalizedLabel = trimmedLabel.toLocaleLowerCase();
  const normalizedTrackName = trackName.trim().toLocaleLowerCase();
  const isHandLabel = /^(?:r\.?\s*h\.?|l\.?\s*h\.?|right hand|left hand)$/i.test(trimmedLabel);
  if (isHandLabel) return trimmedLabel;
  if (normalizedLabel === normalizedTrackName) return undefined;

  const trackPrefix = `${normalizedTrackName} · `;
  if (normalizedTrackName && normalizedLabel.startsWith(trackPrefix)) {
    const remainder = trimmedLabel.slice(trackPrefix.length).trim();
    return remainder ? `${remainder[0].toUpperCase()}${remainder.slice(1)}` : undefined;
  }
  return trimmedLabel;
}

function durationToVex(dur: string, isRest?: boolean, dotted?: boolean): string {
  let d = dur;
  if (isRest) d += 'r';
  if (dotted) d += 'd';
  return d;
}

const articulationMap: Record<string, string> = {
  staccato: 'a.',
  fermata: 'a@a',
  accent: 'a>',
  tenuto: 'a-',
};

export interface RenderResult {
  noteElements: Map<string, {
    x: number;
    y: number;
    measureIdx: number;
    noteIdx: number;
    clef: StaffClef;
    voiceIdx: number;
  }>;
  measureRegions: Array<{
    measureIdx: number;
    clef: StaffClef;
    x: number;
    y: number;
    width: number;
    height: number;
    voiceSplitY: number;
    playbackAnchors: Array<{ progress: number; x: number }>;
  }>;
  totalHeight: number;
}

export function getPlaybackCursorX(
  anchors: ReadonlyArray<{ progress: number; x: number }>,
  progress: number,
): number | null {
  if (anchors.length === 0) return null;
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  // Engraving engines vary spacing around accidentals, rests, and chords.
  // Following every glyph therefore produces visible micro-accelerations even
  // at a steady tempo. The playhead is a progress indicator, so keep its speed
  // constant between the measure's first position and the next downbeat.
  return first.x + (last.x - first.x) * clampedProgress;
}

type PlaybackAnchorKind = 'note' | 'rest' | 'measure-rest' | 'spacer';

export function shouldUsePlaybackAnchor(
  kind: PlaybackAnchorKind,
  measureHasSoundingNotes: boolean,
): boolean {
  return kind !== 'measure-rest' || !measureHasSoundingNotes;
}

export function getPlaybackAnchorX(
  candidates: ReadonlyArray<{ x: number; kind: PlaybackAnchorKind }>,
): number | null {
  if (candidates.length === 0) return null;
  const soundingNotes = candidates.filter((candidate) => candidate.kind === 'note');
  const visibleRests = candidates.filter((candidate) => candidate.kind === 'rest');
  const preferred = soundingNotes.length > 0
    ? soundingNotes
    : visibleRests.length > 0
      ? visibleRests
      : candidates;
  // Independently formatted staves can place simultaneous symbols a few pixels
  // apart. The leftmost onset ensures audio never precedes the playhead.
  return Math.min(...preferred.map((candidate) => candidate.x));
}

export function getContinuousPlaybackEndX(
  current: Pick<RenderResult['measureRegions'][number], 'x' | 'y'>,
  next: Pick<RenderResult['measureRegions'][number], 'x' | 'y' | 'playbackAnchors'> | undefined,
): number | null {
  if (!next || next.x <= current.x || Math.abs(next.y - current.y) > 0.5) return null;
  return next.playbackAnchors[0]?.x ?? null;
}

export interface SelectedMeasure {
  measureIdx: number;
  clef: StaffClef;
}

export type NoteNameMode = 'off' | 'inside' | 'below';

export function renderSong(
  container: HTMLDivElement,
  song: EditableScore,
  selectedNoteId?: string | null,
  highlightedNoteIds?: ReadonlySet<string> | null,
  availableWidth = START_X + DEFAULT_STAVE_WIDTH * MAX_MEASURES_PER_ROW + 40,
  selectedMeasure?: SelectedMeasure | null,
  noteNameMode: NoteNameMode = 'off',
): RenderResult {
  container.innerHTML = '';
  const noteElements: RenderResult['noteElements'] = new Map();
  const measureRegions: RenderResult['measureRegions'] = [];
  const renderedNotes = new Map<string, {
    note: StaveNote;
    source: NoteEntry;
    row: number;
    clef: StaffClef;
    voiceIdx: number;
    slurPlacement: SlurPlacement;
  }>();
  const noteNameLabels: Array<{
    x: number;
    y: number;
    text: string;
    hollow: boolean;
    placement: Exclude<NoteNameMode, 'off'>;
  }> = [];

  const visibleClefs: StaffClef[] = song.staffLayout === 'bass-only'
    ? ['bass']
    : song.staffLayout === 'treble-only'
      ? ['treble']
      : ['treble', 'bass'];
  const isSingleStaff = visibleClefs.length === 1;
  const rowHeight = isSingleStaff ? SINGLE_ROW_HEIGHT : ROW_HEIGHT;

  const layoutWidth = Math.max(START_X + MIN_STAVE_WIDTH + 40, availableWidth);
  const measuresPerRow = Math.max(
    1,
    Math.min(
      MAX_MEASURES_PER_ROW,
      Math.floor((layoutWidth - START_X - 40) / MIN_STAVE_WIDTH),
    ),
  );
  const staveWidth = Math.min(
    310,
    Math.max(
      MIN_STAVE_WIDTH,
      Math.floor((layoutWidth - START_X - 40) / measuresPerRow),
    ),
  );
  const numRows = Math.max(1, Math.ceil(song.measures.length / measuresPerRow));
  const totalWidth = START_X + staveWidth * measuresPerRow + 40;
  const totalHeight = HEADER_HEIGHT + numRows * rowHeight + 30;

  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(totalWidth, totalHeight);
  const context = renderer.getContext();
  context.setFont('Arial', 10);

  const title = song.title.trim() || 'Untitled';
  context.save();
  context.setFillStyle('#18181b');
  let titleFontSize = 24;
  context.setFont('Georgia', titleFontSize, 'bold');
  let titleWidth = context.measureText(title).width;
  while (titleFontSize > 14 && titleWidth > totalWidth - START_X * 2) {
    titleFontSize -= 1;
    context.setFont('Georgia', titleFontSize, 'bold');
    titleWidth = context.measureText(title).width;
  }
  context.fillText(title, Math.max(START_X, (totalWidth - titleWidth) / 2), TITLE_BASELINE);
  context.setFont('Arial', 12, 'normal');
  context.fillText(`♩ = ${song.tempo}`, START_X + 12, TEMPO_BASELINE);
  context.restore();

  for (let mi = 0; mi < song.measures.length; mi++) {
    const measure = song.measures[mi];
    const playbackAnchorCandidates: Array<{
      progress: number;
      x: number;
      kind: PlaybackAnchorKind;
    }> = [];
    const currentMeasureRegions: RenderResult['measureRegions'] = [];
    const row = Math.floor(mi / measuresPerRow);
    const col = mi % measuresPerRow;
    const x = START_X + col * staveWidth;
    const staveYs: Record<StaffClef, number> = isSingleStaff
      ? {
          treble: HEADER_HEIGHT + row * rowHeight + SINGLE_STAFF_OFFSET,
          bass: HEADER_HEIGHT + row * rowHeight + SINGLE_STAFF_OFFSET,
        }
      : {
          treble: HEADER_HEIGHT + row * rowHeight + TREBLE_OFFSET,
          bass: HEADER_HEIGHT + row * rowHeight + BASS_OFFSET,
        };
    const staves: Partial<Record<StaffClef, Stave>> = {};

    for (const clef of visibleClefs) {
      const displayClef = song.staffClefs?.[clef] ?? clef;
      const regionY = staveYs[clef] + 25;
      const measureRegion: RenderResult['measureRegions'][number] = {
        measureIdx: mi,
        clef,
        x,
        y: regionY,
        width: staveWidth,
        height: 70,
        voiceSplitY: staveYs[clef] + 60,
        playbackAnchors: [],
      };
      measureRegions.push(measureRegion);
      currentMeasureRegions.push(measureRegion);
      if (selectedMeasure?.measureIdx === mi && selectedMeasure.clef === clef) {
        context.save();
        context.setFillStyle('#eff6ff');
        context.fillRect(x + 1, regionY, staveWidth - 2, 70);
        context.restore();
      }
      const stave = new Stave(x, staveYs[clef], staveWidth);
      staves[clef] = stave;
      if (col === 0) {
        stave.addClef(displayClef);
        if (displayClef !== 'percussion' && song.keySignature && song.keySignature !== 'C') {
          stave.addKeySignature(song.keySignature);
        }
        if (mi === 0) {
          stave.addTimeSignature(`${song.timeSignature[0]}/${song.timeSignature[1]}`);
        }
      }
      if (measure.repeatStart) stave.setBegBarType(BarlineType.REPEAT_BEGIN);
      if (measure.repeatEnd) stave.setEndBarType(BarlineType.REPEAT_END);
      stave.setContext(context).draw();
    }

    const firstClef = visibleClefs[0];
    context.save();
    context.setFont('Arial', 9, 'normal');
    context.fillText(`${mi + 1}`, x + 3, staveYs[firstClef] - 4);
    if (col === 0 && isSingleStaff) {
      const labels = song.voiceLabels?.[firstClef];
      context.setFont('Arial', 11, 'bold');
      const upperLabel = getRenderedVoiceLabel(labels?.[0], song.name);
      const lowerLabel = getRenderedVoiceLabel(labels?.[1], song.name);
      if (upperLabel) context.fillText(upperLabel, x + 12, staveYs[firstClef] + UPPER_VOICE_LABEL_OFFSET);
      if (lowerLabel) context.fillText(lowerLabel, x + 12, staveYs[firstClef] + LOWER_VOICE_LABEL_OFFSET);
    } else if (col === 0) {
      context.setFont('Arial', 11, 'bold');
      visibleClefs.forEach((clef) => {
        const label = getRenderedVoiceLabel(song.voiceLabels?.[clef]?.[0], song.name);
        if (label) context.fillText(label, x + 12, staveYs[clef] + UPPER_VOICE_LABEL_OFFSET);
      });
    }
    context.restore();

    const trebleStave = staves.treble;
    const bassStave = staves.bass;
    if (trebleStave && bassStave) {
      if (col === 0) {
        new StaveConnector(trebleStave, bassStave)
          .setType('brace')
          .setContext(context)
          .draw();
        new StaveConnector(trebleStave, bassStave)
          .setType('singleLeft')
          .setContext(context)
          .draw();
      }
      new StaveConnector(trebleStave, bassStave)
        .setType('singleRight')
        .setContext(context)
        .draw();
    }

    // Each staff can contain multiple independent voices. The primary voice is
    // the upper voice; additional voices use downward stems for visual separation.
    for (const clef of visibleClefs) {
      const stave = staves[clef];
      if (!stave) continue;
      const displayClef = song.staffClefs?.[clef] ?? clef;
      const noteGroups = getMeasureVoices(measure, clef);
      const accidentalDisplay = getMeasureAccidentalDisplay(measure, clef, song.keySignature);
      const multipleVoices = noteGroups.filter((notes) => notes.length > 0).length > 1;
      const measureCapacity = getMeasureCapacity(song.timeSignature);
      const voiceData = noteGroups.flatMap((notes, voiceIdx) => {
        if (notes.length === 0) return [];
        const isFullMeasureRest = notes.length === 1
          && notes[0].isRest
          && getMeasureBeatCount(notes) >= measureCapacity;
        const vexNotes = notes.map((note) => {
          const renderKeys = !note.isRest && note.drumMidi
            ? note.keys.map((key, keyIdx) => {
                const midi = note.drumMidi?.[keyIdx] ?? 0;
                const usesXHead = [42, 44, 46, 49, 51, 52, 55, 57, 59].includes(midi);
                return usesXHead ? `${key}/x` : key;
              })
            : note.keys;
          const staveNote = new StaveNote({
            keys: note.isRest
              ? (displayClef === 'bass' ? ['d/3'] : ['b/4'])
              : renderKeys,
            duration: durationToVex(note.duration, note.isRest, note.dotted),
            clef: displayClef,
            alignCenter: isFullMeasureRest,
            autoStem: !multipleVoices,
            stemDirection: multipleVoices ? (voiceIdx === 0 ? Stem.UP : Stem.DOWN) : undefined,
          });

          if (note.isRest) {
            const voiceLane = multipleVoices ? (voiceIdx === 0 ? 1.5 : -1.5) : 0;
            staveNote.setKeyLine(0, 3 + voiceLane + (note.restOffset ?? 0));
          }

          if (note.isSpacer) {
            staveNote.setStyle({ fillStyle: 'transparent', strokeStyle: 'transparent' });
          }

          if (!note.isRest && !note.drumMidi) {
            accidentalDisplay.get(note.id)?.forEach((accidental, index) => {
              if (accidental) staveNote.addModifier(new Accidental(accidental), index);
            });
          }
          if (note.dotted) Dot.buildAndAttach([staveNote]);
          note.articulations?.forEach((articulation) => {
            const vexArticulation = articulationMap[articulation];
            if (vexArticulation) {
              staveNote.addModifier(
                new Articulation(vexArticulation).setPosition(
                  staveNote.getStemDirection() === Stem.DOWN
                    ? Modifier.Position.BELOW
                    : Modifier.Position.ABOVE,
                ),
              );
            }
          });
          if (note.dynamic) {
            staveNote.addModifier(
              new Annotation(note.dynamic)
                .setVerticalJustification(Annotation.VerticalJustify.BOTTOM),
            );
          }
          if (note.pedalStart) {
            staveNote.addModifier(
              new Annotation('Ped.')
                .setVerticalJustification(Annotation.VerticalJustify.BOTTOM),
            );
          }
          if (note.pedalEnd) {
            staveNote.addModifier(
              new Annotation('*')
                .setVerticalJustification(Annotation.VerticalJustify.BOTTOM),
            );
          }
          if (note.id === selectedNoteId) {
            staveNote.setStyle({ fillStyle: '#2563eb', strokeStyle: '#2563eb' });
          }
          if (highlightedNoteIds?.has(note.id)) {
            staveNote.setStyle({ fillStyle: '#dc2626', strokeStyle: '#dc2626' });
          }
          return staveNote;
        });
        const voice = new Voice({
          numBeats: song.timeSignature[0],
          beatValue: song.timeSignature[1],
        }).setStrict(false);
        voice.addTickables(vexNotes);
        return [{ notes, vexNotes, voice, voiceIdx, isFullMeasureRest }];
      });

      if (voiceData.length === 0) continue;
      const voices = voiceData.map(({ voice }) => voice);
      new Formatter()
        .joinVoices(voices)
        .format(voices, staveWidth - (col === 0 ? 80 : 30));

      // Generate beams before notes are drawn. This lets VexFlow suppress the
      // individual eighth/sixteenth-note flags that a beam replaces.
      const beamsByVoice = new Map<number, Beam[]>();
      for (const { vexNotes, voiceIdx } of voiceData) {
        try {
          beamsByVoice.set(
            voiceIdx,
            Beam.generateBeams(vexNotes, { maintainStemDirections: true }),
          );
        } catch {
          beamsByVoice.set(voiceIdx, []);
        }
      }

      for (const { notes, vexNotes, voice, voiceIdx, isFullMeasureRest } of voiceData) {
        voice.draw(context, stave);
        const renderedNoteElements = Array.from(
          container.querySelectorAll<SVGGElement>('.vf-stavenote'),
        ).slice(-vexNotes.length);

        beamsByVoice.get(voiceIdx)?.forEach((beam) => beam.setContext(context).draw());

        let elapsedBeats = 0;
        vexNotes.forEach((vexNote, noteIdx) => {
          const note = notes[noteIdx];
          playbackAnchorCandidates.push({
            progress: isFullMeasureRest
              ? 0.5
              : Math.max(0, Math.min(1, elapsedBeats / measureCapacity)),
            x: vexNote.getAbsoluteX(),
            kind: note.isSpacer
              ? 'spacer'
              : isFullMeasureRest
                ? 'measure-rest'
                : note.isRest
                  ? 'rest'
                  : 'note',
          });
          elapsedBeats += getNoteBeatValue(note);
          if (note.isSpacer) return;
          if (noteNameMode === 'inside' && !note.isRest && !note.drumMidi) {
            const hollow = note.duration === 'w' || note.duration === 'h';
            vexNote.noteHeads.forEach((noteHead, keyIdx) => {
              const letter = note.keys[keyIdx]?.[0]?.toUpperCase();
              if (!letter) return;
              noteNameLabels.push({
                x: noteHead.getAbsoluteX() + noteHead.getWidth() / 2,
                y: noteHead.getY(),
                text: letter,
                hollow,
                placement: 'inside',
              });
            });
          } else if (noteNameMode === 'below' && !note.isRest && !note.drumMidi) {
            const heads = vexNote.noteHeads;
            const centers = heads.map((head) => head.getAbsoluteX() + head.getWidth() / 2);
            const text = note.keys.map((key) => key[0]?.toUpperCase()).join('');
            if (centers.length > 0 && text) {
              noteNameLabels.push({
                x: centers.reduce((sum, center) => sum + center, 0) / centers.length
                  + (vexNote.getStemDirection() === Stem.DOWN ? 9 : 0),
                y: Math.max(...heads.map((head) => head.getY())) + 14,
                text,
                hollow: false,
                placement: 'below',
              });
            }
          }
          const inferredSlurPlacement: SlurPlacement = voiceIdx > 0
            ? 'below'
            : (clef === 'treble' || song.staffLayout === 'bass-only' ? 'above' : 'below');
          renderedNotes.set(note.id, {
            note: vexNote,
            source: note,
            row,
            clef,
            voiceIdx,
            slurPlacement: note.slurPlacement ?? inferredSlurPlacement,
          });
          renderedNoteElements[noteIdx]?.setAttribute('data-note-id', note.id);
          const noteYPositions = vexNote.getYs();
          if (noteYPositions.length > 0) {
            noteElements.set(note.id, {
              x: vexNote.getAbsoluteX(),
              y: noteYPositions.reduce((sum, y) => sum + y, 0) / noteYPositions.length,
              measureIdx: mi,
              noteIdx,
              clef,
              voiceIdx,
            });
          }
        });
      }
    }

    const groupedAnchors = new Map<number, Array<{ x: number; kind: PlaybackAnchorKind }>>();
    const measureHasSoundingNotes = playbackAnchorCandidates.some(({ kind }) => kind === 'note');
    playbackAnchorCandidates
      .filter(({ kind }) => shouldUsePlaybackAnchor(kind, measureHasSoundingNotes))
      .forEach(({ progress, x: anchorX, kind }) => {
        const key = Math.round(progress * 1_000_000);
        const candidates = groupedAnchors.get(key) ?? [];
        candidates.push({ x: anchorX, kind });
        groupedAnchors.set(key, candidates);
      });
    const firstStave = staves[firstClef];
    const playbackAnchors = [...groupedAnchors.entries()]
      .map(([progressKey, candidates]) => ({
        progress: progressKey / 1_000_000,
        x: getPlaybackAnchorX(candidates) ?? x + 5,
      }))
      .sort((a, b) => a.progress - b.progress);
    if (playbackAnchors.length === 0 || playbackAnchors[0].progress > 0) {
      playbackAnchors.unshift({
        progress: 0,
        x: firstStave?.getNoteStartX() ?? x + 5,
      });
    }
    playbackAnchors.push({
      progress: 1,
      x: firstStave?.getNoteEndX() ?? x + staveWidth - 5,
    });
    currentMeasureRegions.forEach((region) => {
      region.playbackAnchors = playbackAnchors;
    });
  }

  // On one engraved system, a playhead should travel continuously into the
  // following downbeat. Using the current barline as the end point and the
  // next note as the next start point creates a visible jump through the
  // notation's leading whitespace. Row changes still wrap normally.
  const referenceRegionByMeasure = new Map<number, RenderResult['measureRegions'][number]>();
  measureRegions.forEach((region) => {
    if (!referenceRegionByMeasure.has(region.measureIdx)) {
      referenceRegionByMeasure.set(region.measureIdx, region);
    }
  });
  referenceRegionByMeasure.forEach((currentRegion, measureIdx) => {
    const nextRegion = referenceRegionByMeasure.get(measureIdx + 1);
    const continuousEndX = getContinuousPlaybackEndX(currentRegion, nextRegion);
    if (continuousEndX === null) return;
    measureRegions
      .filter((region) => region.measureIdx === measureIdx)
      .forEach((region) => {
        const terminalAnchor = region.playbackAnchors.at(-1);
        if (terminalAnchor?.progress === 1) terminalAnchor.x = continuousEndX;
      });
  });

  const drawTie = (startId: string, endId: string) => {
    const start = renderedNotes.get(startId);
    const end = renderedNotes.get(endId);
    if (!start || !end || start.clef !== end.clef || start.voiceIdx !== end.voiceIdx) return;
    const { firstIndexes, lastIndexes } = getTieIndexes(
      start.source,
      end.source,
      song.keySignature,
    );
    if (firstIndexes.length === 0) return;

    if (start.row === end.row) {
      new StaveTie({
        firstNote: start.note,
        lastNote: end.note,
        firstIndexes,
        lastIndexes,
      }).setContext(context).draw();
      return;
    }

    new StaveTie({
      firstNote: start.note,
      lastNote: null,
      firstIndexes,
      lastIndexes: firstIndexes,
    }).setContext(context).draw();
    new StaveTie({
      firstNote: null,
      lastNote: end.note,
      firstIndexes: lastIndexes,
      lastIndexes,
    }).setContext(context).draw();
  };

  for (const clef of visibleClefs) {
    const maxVoiceCount = Math.max(
      1,
      ...song.measures.map((measure) => getMeasureVoices(measure, clef).length),
    );
    for (let voiceIdx = 0; voiceIdx < maxVoiceCount; voiceIdx++) {
      const notes = song.measures.flatMap((measure) => (
        getMeasureVoices(measure, clef)[voiceIdx] ?? []
      ));
      notes.forEach((note, noteIndex) => {
        if (note.tieToNext && notes[noteIndex + 1]) {
          drawTie(note.id, notes[noteIndex + 1].id);
        }
      });
    }
  }

  const drawSlur = (startId: string, endId: string) => {
    const start = renderedNotes.get(startId);
    const end = renderedNotes.get(endId);
    if (!start || !end || start.clef !== end.clef) return;

    const drawCurve = (
      from: StaveNote | undefined,
      to: StaveNote | undefined,
      height: number,
      placement: SlurPlacement,
    ) => {
      const positionFor = (note: StaveNote | undefined) => {
        if (!note) return Curve.Position.NEAR_HEAD;
        const stemPointsTowardPlacement = placement === 'above'
          ? note.getStemDirection() === Stem.UP
          : note.getStemDirection() === Stem.DOWN;
        return stemPointsTowardPlacement
          ? Curve.Position.NEAR_TOP
          : Curve.Position.NEAR_HEAD;
      };
      new Curve(from, to, {
        yShift: 4,
        thickness: 1.6,
        position: positionFor(from ?? to),
        positionEnd: positionFor(to ?? from),
        openingDirection: placement === 'above' ? 'down' : 'up',
        cps: [{ x: 0, y: height }, { x: 0, y: height }],
      }).setContext(context).draw();
    };

    if (start.row === end.row) {
      const span = Math.abs(end.note.getAbsoluteX() - start.note.getAbsoluteX());
      drawCurve(
        start.note,
        end.note,
        Math.max(20, Math.min(46, span * 0.18)),
        start.slurPlacement,
      );
      return;
    }

    // VexFlow represents system-spanning slurs as two open curve segments.
    drawCurve(start.note, undefined, 34, start.slurPlacement);
    drawCurve(undefined, end.note, 34, start.slurPlacement);
  };

  for (const clef of visibleClefs) {
    const allNotes = song.measures.flatMap((measure) => getMeasureVoices(measure, clef).flat());
    allNotes.forEach((note) => {
      if (note.slurToNoteId) {
        drawSlur(note.id, note.slurToNoteId);
      }
    });

    const maxVoiceCount = Math.max(
      1,
      ...song.measures.map((measure) => getMeasureVoices(measure, clef).length),
    );
    for (let voiceIdx = 0; voiceIdx < maxVoiceCount; voiceIdx++) {
      const notes = song.measures.flatMap((measure) => (
        getMeasureVoices(measure, clef)[voiceIdx] ?? []
      ));
      notes.forEach((note, noteIndex) => {
        if (note.slurToNoteId || !note.slurStart) return;
        const end = notes.slice(noteIndex + 1).find((candidate) => candidate.slurEnd);
        if (end) drawSlur(note.id, end.id);
      });
    }
  }

  const svg = container.querySelector('svg');
  if (svg && noteNameMode !== 'off' && noteNameLabels.length > 0) {
    const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    labelGroup.setAttribute('class', 'note-name-labels');
    labelGroup.setAttribute('aria-hidden', 'true');
    noteNameLabels.forEach(({ x, y, text, hollow, placement }) => {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', `note-name-label note-name-label-${placement}`);
      label.setAttribute('x', String(x));
      label.setAttribute('y', String(y));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('fill', placement === 'below' || hollow ? '#111827' : '#ffffff');
      label.setAttribute('font-family', 'Arial, sans-serif');
      label.setAttribute('font-size', placement === 'below' ? '10' : '8');
      label.setAttribute('font-weight', placement === 'below' ? '800' : '900');
      label.setAttribute('paint-order', 'stroke');
      if (placement === 'below') {
        label.setAttribute('stroke', '#fffef9');
        label.setAttribute('stroke-width', '3');
        label.setAttribute('stroke-linejoin', 'round');
      } else if (!hollow) {
        label.setAttribute('stroke', '#ffffff');
        label.setAttribute('stroke-width', '0.45');
      }
      label.textContent = text;
      labelGroup.appendChild(label);
    });
    svg.appendChild(labelGroup);
  }
  svg?.setAttribute('role', 'img');
  svg?.setAttribute('aria-label', `Sheet music for ${title}`);

  return { noteElements, measureRegions, totalHeight };
}
