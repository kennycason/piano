import React from 'react';
import './PlaybackBar.css';

interface PlaybackBarProps {
  songId: string;
  playState: 'stopped' | 'loading' | 'playing' | 'paused';
  loopEnabled: boolean;
  recordingEnabled: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onLoopToggle: () => void;
  onRecordingToggle: () => void;
  songTitle: string;
  onTitleChange: (title: string) => void;
  currentMeasure: number;
  totalMeasures: number;
  tracks: ReadonlyArray<{ id: string; name: string; kind: 'pitched' | 'percussion'; muted?: boolean }>;
  activeTrackId: string;
  soloActiveTrack: boolean;
  onTrackChange: (trackId: string) => void;
  onSoloActiveTrackToggle: () => void;
  onActiveTrackMuteToggle: () => void;
}

export const PlaybackBar: React.FC<PlaybackBarProps> = ({
  songId,
  playState,
  loopEnabled,
  recordingEnabled,
  onPlay,
  onPause,
  onStop,
  onLoopToggle,
  onRecordingToggle,
  songTitle,
  onTitleChange,
  currentMeasure,
  totalMeasures,
  tracks,
  activeTrackId,
  soloActiveTrack,
  onTrackChange,
  onSoloActiveTrackToggle,
  onActiveTrackMuteToggle,
}) => {
  const activeTrackIndex = Math.max(0, tracks.findIndex((track) => track.id === activeTrackId));
  const activeTrack = tracks[activeTrackIndex] ?? tracks[0];

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
            className={`transport-btn record-btn ${recordingEnabled ? 'active' : ''}`}
            onClick={onRecordingToggle}
            title={recordingEnabled
              ? 'Record notes: on — keyboard input is added to the score'
              : 'Free Play — keyboard input makes sound without changing the score'}
            aria-label={recordingEnabled ? 'Turn off note recording and enter Free Play' : 'Turn on note recording'}
            aria-pressed={recordingEnabled}
          >
            <span className="record-dot" aria-hidden="true" />
            {/*<span className="record-label">Record</span>*/}
          </button>
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
        <div className="bar-counter" aria-live="polite">
          {playState === 'loading' ? 'Loading…' : `Bar ${currentMeasure + 1}/${totalMeasures}`}
        </div>
      </div>
      <div className="playback-right">
        <div className="track-navigation" aria-label="MIDI and score tracks">
          <label className="track-select-label">
            <span className="track-kind-icon" aria-hidden="true">
              {activeTrack?.kind === 'percussion' ? '◉' : '♪'}
            </span>
            <select
              className="track-select"
              value={activeTrack?.id ?? ''}
              onChange={(event) => onTrackChange(event.target.value)}
              aria-label="Active score track"
            >
              {tracks.map((track, index) => (
                <option key={track.id} value={track.id}>
                  {index + 1}. {track.name}{track.muted ? ' (muted)' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className="track-count">{activeTrackIndex + 1}/{tracks.length}</span>
          <button
            type="button"
            className={`track-mode-btn ${soloActiveTrack ? 'active' : ''}`}
            onClick={onSoloActiveTrackToggle}
            aria-pressed={soloActiveTrack}
            title="Play only the active track"
          >
            Solo
          </button>
          <button
            type="button"
            className={`track-mode-btn ${activeTrack?.muted ? 'active mute' : ''}`}
            onClick={onActiveTrackMuteToggle}
            aria-pressed={Boolean(activeTrack?.muted)}
            title="Mute this track during ensemble playback"
          >
            Mute
          </button>
        </div>
      </div>
    </div>
  );
};
