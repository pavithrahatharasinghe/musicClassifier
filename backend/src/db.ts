import Database from 'better-sqlite3';
import path from 'path';

// Store the SQLite file in the root of the backend folder
const dbPath = path.join(process.cwd(), 'database.sqlite');
export const db = new Database(dbPath, { verbose: console.log });

// Enable performance PRAGMAs
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    baseName TEXT NOT NULL,
    extension TEXT NOT NULL,
    absolutePath TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    youtubeUrl TEXT,
    spotifyUrl TEXT,
    previewUrl TEXT,
    albumArt TEXT,
    isrc TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pairs (
    id TEXT PRIMARY KEY,
    audioId TEXT NOT NULL,
    videoId TEXT NOT NULL,
    status TEXT NOT NULL,
    genre TEXT,
    cleanName TEXT,
    matchConfidence REAL,
    aiCategory TEXT,
    isOfficial BOOLEAN,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(audioId) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY(videoId) REFERENCES files(id) ON DELETE CASCADE
  );
`);

// Migration for adding previewUrl if missing
try {
  db.exec('ALTER TABLE files ADD COLUMN previewUrl TEXT;');
  console.log('✅ SQLite Migration: added previewUrl column');
} catch (e) {
  // column likely exists
}

console.log('✅ SQLite Database Initialized');
