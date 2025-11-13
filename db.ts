import Database from 'better-sqlite3';

const db = new Database('data.db', { verbose: console.log });

db.exec(`
CREATE TABLE IF NOT EXISTS guilds (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    discordId       TEXT    NOT NULL,
    roleId          TEXT,

    -- Wave mode configuration
    wave_vote       INTEGER NOT NULL,
    wave_result     INTEGER NOT NULL,
    wave_turn       INTEGER NOT NULL,
    wave_extension  INTEGER NOT NULL,
    wave_pause      INTEGER NOT NULL,
    wave_jail       INTEGER NOT NULL,

    -- Queue mode configuration
    queue_vote      INTEGER NOT NULL,
    queue_result    INTEGER NOT NULL,
    queue_turn      INTEGER NOT NULL,
    queue_extension INTEGER NOT NULL,
    queue_pause     INTEGER NOT NULL,
    queue_jail      INTEGER NOT NULL
);
`);

export default db;
