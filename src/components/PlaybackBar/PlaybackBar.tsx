import React from 'react';
import { KEY_SIGNATURES } from '../../models/song';
import './PlaybackBar.css';

interface PlaybackBarProps {
  songId: string;
  playState: 'stopped' | 'loading' | 'playing' | 'paused';
  tempo: number;
  keySignature: string;
  loopEnabled: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onLoopToggle: () => void;
  onTempoChange: (tempo: number) => void;
  onKeySignatureChange: (keySignature: string) => void;
  songTitle: string;
  onTitleChange: (title: string) => void;
  currentMeasure: number;
  totalMeasures: number;
}

export const PlaybackBar: React.FC<PlaybackBarProps> = ({
  songId,
  playState,
  tempo,
  keySignature,
  loopEnabled,
  onPlay,
  onPause,
  onStop,
  onLoopToggle,
  onTempoChange,
  onKeySignatureChange,
  songTitle,
  onTitleChange,
  currentMeasure,
  totalMeasures,
}) => {
  const progress = totalMeasures > 0 ? ((currentMeasure + 1) / totalMeasures) * 100 : 0;

  return (
    <div className="playback-bar">
      <div className="playback-left">
        <input
          key={`title-${songId}-${songTitle}`}
          className="song-title-input"
          defaultValue={songTitle}
          onBlur={(event) => {
            const nextTitle = event.target.value.trim() || 'Untitled';
            event.target.value = nextTitle;
            if (nextTitle !== songTitle) onTitleChange(nextTitle);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          placeholder="Song title..."
          aria-label="Song title"
        />
      </div>
      <div className="playback-center">
        <div className="transport-controls">
          {/* Stop */}
          <button
            type="button"
            className={`transport-btn ${playState === 'stopped' ? 'active-stop' : ''}`}
            onClick={onStop}
            title="Stop (reset to beginning)"
            disabled={playState === 'stopped'}
            aria-label="Stop and return to beginning"
          >
            <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" rx="1" fill="currentColor"/></svg>
          </button>
          {/* Play / Pause toggle */}
          {playState === 'loading' ? (
            <button type="button" className="transport-btn transport-main loading" title="Loading piano audio" disabled aria-label="Loading piano audio">
              <span className="loading-spinner" />
            </button>
          ) : playState === 'playing' ? (
            <button type="button" className="transport-btn transport-main pause" onClick={onPause} title="Pause" aria-label="Pause">
              <svg width="16" height="16" viewBox="0 0 16 16">
                <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor"/>
                <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor"/>
              </svg>
            </button>
          ) : (
            <button type="button" className="transport-btn transport-main play" onClick={onPlay} title={playState === 'paused' ? 'Resume (Space)' : 'Play (Space)'} aria-label={playState === 'paused' ? 'Resume' : 'Play'}>
              <svg width="16" height="16" viewBox="0 0 16 16">
                <polygon points="3,1 14,8 3,15" fill="currentColor"/>
              </svg>
            </button>
          )}
          <button
            type="button"
            className={`transport-btn loop-btn ${loopEnabled ? 'active' : ''}`}
            onClick={onLoopToggle}
            title={`Loop whole song: ${loopEnabled ? 'on' : 'off'}`}
            aria-label="Loop whole song"
            aria-pressed={loopEnabled}
          >
            <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M4 5.25h8.2l-1.8-1.8M14 12.75H5.8l1.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M13.8 5.3c.8.75 1.2 1.7 1.2 2.7M4.2 12.7C3.4 11.95 3 11 3 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        {/* Always mounted so transport controls never shift between states. */}
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
          <span className="progress-text">
            {playState === 'loading' ? 'Loading piano…' : `Bar ${currentMeasure + 1} / ${totalMeasures}`}
          </span>
        </div>
      </div>
      <div className="playback-right">
        <label className="key-signature-label">
          Key
          <select
            className="key-signature-select"
            value={keySignature}
            onChange={(event) => onKeySignatureChange(event.target.value)}
            aria-label="Key signature"
          >
            {KEY_SIGNATURES.map((key) => (
              <option key={key} value={key}>{key}</option>
            ))}
          </select>
        </label>
        <label className="tempo-label">
          <svg width="14" height="14" viewBox="0 0 14 14" style={{ display: 'block', opacity: 0.7 }}>
            <ellipse cx="5" cy="10.5" rx="4" ry="3" fill="currentColor" transform="rotate(-15 5 10.5)" />
            <line x1="8.5" y1="9" x2="8.5" y2="1" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          =
          <input
            key={`tempo-${songId}-${tempo}`}
            type="number"
            className="tempo-input"
            defaultValue={tempo}
            onBlur={(event) => {
              const parsedTempo = Number(event.target.value);
              const nextTempo = Number.isFinite(parsedTempo)
                ? Math.max(20, Math.min(300, Math.round(parsedTempo)))
                : tempo;
              event.target.value = String(nextTempo);
              if (nextTempo !== tempo) onTempoChange(nextTempo);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            min={20}
            max={300}
            aria-label="Tempo in beats per minute"
          />
          BPM
        </label>
      </div>
    </div>
  );
};
