import React, { useRef } from 'react';
import type { Song } from '../../models/song';
import './SongManager.css';

interface SongManagerProps {
  songs: Song[];
  currentSongId: string;
  onSelectSong: (id: string) => void;
  onNewSong: () => void;
  onDeleteSong: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

export const SongManager: React.FC<SongManagerProps> = ({
  songs,
  currentSongId,
  onSelectSong,
  onNewSong,
  onDeleteSong,
  onExport,
  onImport,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="song-manager" aria-label="Song library">
      <div className="song-manager-header">
        <h3>Songs</h3>
        <div className="song-manager-actions">
          <button type="button" className="sm-btn" onClick={onNewSong}>New</button>
          <button type="button" className="sm-btn" onClick={onExport}>Export</button>
          <button
            type="button"
            className="sm-btn"
            onClick={() => fileRef.current?.click()}
            title="Import a Piano Sheet JSON or MIDI file"
            aria-label="Import JSON or MIDI"
          >
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.mid,.midi,audio/midi,audio/x-midi"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <div className="song-list">
        {songs.map((song) => (
          <div
            key={song.id}
            className={`song-item ${song.id === currentSongId ? 'active' : ''}`}
          >
            <button
              type="button"
              className="song-select-btn"
              onClick={() => onSelectSong(song.id)}
              aria-current={song.id === currentSongId ? 'true' : undefined}
            >
              <span className="song-item-title">{song.title || 'Untitled'}</span>
              <span className="song-item-info">
                {song.measures.length} bars · {song.tempo} BPM
              </span>
            </button>
            <button
              type="button"
              className="song-delete-btn"
              onClick={() => onDeleteSong(song.id)}
              title={`Delete ${song.title || 'Untitled'}`}
              aria-label={`Delete ${song.title || 'Untitled'}`}
            >
              ×
            </button>
          </div>
        ))}
        {songs.length === 0 && (
          <div className="song-empty">No songs yet. Create one!</div>
        )}
      </div>
    </aside>
  );
};
