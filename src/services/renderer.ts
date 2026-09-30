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
} from 'vexflow';
import {
  getKeySignatureAccidental,
  getMeasureBeatCount,
  getMeasureCapacity,
  getMeasureVoices,
} from '../models/song';
import type { SlurPlacement, Song, StaffClef } from '../models/song';

const DEFAULT_STAVE_WIDTH = 280;
const MIN_STAVE_WIDTH = 240;
const START_X = 40;
const HEADER_HEIGHT = 78;
const TREBLE_OFFSET = 18;
const BASS_OFFSET = 128;
const ROW_HEIGHT = 250;
const SINGLE_STAFF_OFFSET = 46;
const SINGLE_ROW_HEIGHT = 170;
const MAX_MEASURES_PER_ROW = 4;
const UPPER_VOICE_LABEL_OFFSET = 28;
const LOWER_VOICE_LABEL_OFFSET = 96;

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
  }>;
  totalHeight: number;
}

export interface SelectedMeasure {
  measureIdx: number;
  clef: StaffClef;
}

export function renderSong(
  container: HTMLDivElement,
  song: Song,
  selectedNoteId?: string | null,
  highlightedNoteIds?: ReadonlySet<string> | null,
  availableWidth = START_X + DEFAULT_STAVE_WIDTH * MAX_MEASURES_PER_ROW + 40,
  selectedMeasure?: SelectedMeasure | null,
): RenderResult {
  container.innerHTML = '';
  const noteElements: RenderResult['noteElements'] = new Map();
  const measureRegions: RenderResult['measureRegions'] = [];
  const renderedNotes = new Map<string, {
    note: StaveNote;
    row: number;
    clef: StaffClef;
    voiceIdx: number;
    slurPlacement: SlurPlacement;
  }>();

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
  context.setFont('Georgia', 24, 'bold');
  const titleWidth = context.measureText(title).width;
  context.fillText(title, Math.max(START_X, (totalWidth - titleWidth) / 2), 34);
  context.setFont('Arial', 12, 'normal');
  context.fillText(`♩ = ${song.tempo}`, START_X + 12, 63);
  context.restore();

  for (let mi = 0; mi < song.measures.length; mi++) {
    const measure = song.measures[mi];
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
      measureRegions.push({
        measureIdx: mi,
        clef,
        x,
        y: regionY,
        width: staveWidth,
        height: 70,
        voiceSplitY: staveYs[clef] + 60,
      });
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
        if (song.keySignature && song.keySignature !== 'C') {
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
      if (labels?.[0]) context.fillText(labels[0], x + 12, staveYs[firstClef] + UPPER_VOICE_LABEL_OFFSET);
      if (labels?.[1]) context.fillText(labels[1], x + 12, staveYs[firstClef] + LOWER_VOICE_LABEL_OFFSET);
    } else if (col === 0) {
      context.setFont('Arial', 11, 'bold');
      visibleClefs.forEach((clef) => {
        const label = song.voiceLabels?.[clef]?.[0];
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
      const multipleVoices = noteGroups.filter((notes) => notes.length > 0).length > 1;
      const measureCapacity = getMeasureCapacity(song.timeSignature);
      const voiceData = noteGroups.flatMap((notes, voiceIdx) => {
        if (notes.length === 0) return [];
        const isFullMeasureRest = notes.length === 1
          && notes[0].isRest
          && getMeasureBeatCount(notes) >= measureCapacity;
        const vexNotes = notes.map((note) => {
          const staveNote = new StaveNote({
            keys: note.isRest ? (displayClef === 'treble' ? ['b/4'] : ['d/3']) : note.keys,
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

          if (!note.isRest && !note.suppressAccidentals) {
            note.keys.forEach((key, index) => {
              const pitchName = key.split('/')[0];
              const embeddedAccidental = pitchName.slice(1);
              const accidental = note.accidentals?.[index]
                ?? (embeddedAccidental === '#' || embeddedAccidental === 'b' ? embeddedAccidental : null);
              const signatureAccidental = getKeySignatureAccidental(song.keySignature, pitchName);
              if (accidental && (accidental === 'n' || accidental !== signatureAccidental)) {
                staveNote.addModifier(new Accidental(accidental), index);
              }
            });
          }
          if (note.dotted) Dot.buildAndAttach([staveNote]);
          note.articulations?.forEach((articulation) => {
            const vexArticulation = articulationMap[articulation];
            if (vexArticulation) staveNote.addModifier(new Articulation(vexArticulation));
          });
          if (note.dynamic) {
            staveNote.addModifier(
              new Annotation(note.dynamic)
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
        return [{ notes, vexNotes, voice, voiceIdx }];
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

      for (const { notes, vexNotes, voice, voiceIdx } of voiceData) {
        voice.draw(context, stave);
        const renderedNoteElements = Array.from(
          container.querySelectorAll<SVGGElement>('.vf-stavenote'),
        ).slice(-vexNotes.length);

        beamsByVoice.get(voiceIdx)?.forEach((beam) => beam.setContext(context).draw());

        const ties: StaveTie[] = [];
        for (let ni = 0; ni < notes.length - 1; ni++) {
          if (notes[ni].tieToNext) {
            ties.push(new StaveTie({
              firstNote: vexNotes[ni],
              lastNote: vexNotes[ni + 1],
              firstIndexes: [0],
              lastIndexes: [0],
            }));
          }
        }
        ties.forEach((tie) => tie.setContext(context).draw());

        vexNotes.forEach((vexNote, noteIdx) => {
          const note = notes[noteIdx];
          const inferredSlurPlacement: SlurPlacement = voiceIdx > 0
            ? 'below'
            : (clef === 'treble' || song.staffLayout === 'bass-only' ? 'above' : 'below');
          renderedNotes.set(note.id, {
            note: vexNote,
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
  svg?.setAttribute('role', 'img');
  svg?.setAttribute('aria-label', `Sheet music for ${title}`);

  return { noteElements, measureRegions, totalHeight };
}
