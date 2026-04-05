"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
// Store the SQLite file in the root of the backend folder
const dbPath = path_1.default.join(process.cwd(), 'database.sqlite');
exports.db = new better_sqlite3_1.default(dbPath, { verbose: console.log });
// Enable performance PRAGMAs
exports.db.pragma('journal_mode = WAL');
// Initialize schema
exports.db.exec(`
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
    exports.db.exec('ALTER TABLE files ADD COLUMN previewUrl TEXT;');
    console.log('✅ SQLite Migration: added previewUrl column');
}
catch (e) {
    // column likely exists
}
// Migration for adding videoStatus if missing
try {
    exports.db.exec("ALTER TABLE files ADD COLUMN videoStatus TEXT;");
    console.log('✅ SQLite Migration: added videoStatus column');
}
catch (e) {
    // column likely exists
}
console.log('✅ SQLite Database Initialized');
