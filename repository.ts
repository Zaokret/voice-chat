import db from './db';

export interface Guild {
  id: number;
  discordId: string;
  roleId: string | null;
  wave_vote: number;
  wave_result: number;
  wave_turn: number;
  wave_extension: number;
  wave_pause: number;
  wave_jail: number;
  queue_vote: number;
  queue_result: number;
  queue_turn: number;
  queue_extension: number;
  queue_pause: number;
  queue_jail: number; // unused
}

export const defaultConfig = {
  wave_vote: 15,
  wave_result: 15,
  wave_turn: 60,
  wave_extension: 30,
  wave_pause: 4,
  wave_jail: 90,
  queue_vote: 15,
  queue_result: 15,
  queue_turn: 60,
  queue_extension: 30,
  queue_pause: 10,
  queue_jail: 90, // unused
}

export const repository = {
  createGuild(discordId: string, data: Partial<Guild>) {
    const config = { ...defaultConfig, ...data };

    const stmt = db.prepare(`
      INSERT INTO guilds (
        discordId,
        roleId,
        wave_vote,
        wave_result,
        wave_turn,
        wave_extension,
        wave_pause,
        wave_jail,
        queue_vote,
        queue_result,
        queue_turn,
        queue_extension,
        queue_pause,
        queue_jail
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      discordId,
      config.roleId ?? null,
      config.wave_vote,
      config.wave_result,
      config.wave_turn,
      config.wave_extension,
      config.wave_pause,
      config.wave_jail,
      config.queue_vote,
      config.queue_result,
      config.queue_turn,
      config.queue_extension,
      config.queue_pause,
      config.queue_jail
    );

    return result.lastInsertRowid as number;
  },

   updateGuild(discordId: string, data: Partial<Guild>) {
    const stmt = db.prepare(`
      UPDATE guilds
      SET
        roleId = COALESCE(?, roleId),
        wave_vote = COALESCE(?, wave_vote),
        wave_result = COALESCE(?, wave_result),
        wave_turn = COALESCE(?, wave_turn),
        wave_extension = COALESCE(?, wave_extension),
        wave_pause = COALESCE(?, wave_pause),
        wave_jail = COALESCE(?, wave_jail),
        queue_vote = COALESCE(?, queue_vote),
        queue_result = COALESCE(?, queue_result),
        queue_turn = COALESCE(?, queue_turn),
        queue_extension = COALESCE(?, queue_extension),
        queue_pause = COALESCE(?, queue_pause),
        queue_jail = COALESCE(?, queue_jail)
      WHERE discordId = ?
    `);

    return stmt.run(
      data.roleId ?? null,
      data.wave_vote ?? null,
      data.wave_result ?? null,
      data.wave_turn ?? null,
      data.wave_extension ?? null,
      data.wave_pause ?? null,
      data.wave_jail ?? null,
      data.queue_vote ?? null,
      data.queue_result ?? null,
      data.queue_turn ?? null,
      data.queue_extension ?? null,
      data.queue_pause ?? null,
      data.queue_jail ?? null,
      discordId
    );
  },

  getGuildByDiscordId(discordId: string) {
    const stmt = db.prepare('SELECT * FROM guilds WHERE discordId = ?');
    return stmt.get(discordId) as Guild | undefined
  },

  getAllGuilds() {
    const stmt = db.prepare('SELECT * FROM guilds ORDER BY id');
    return stmt.all() as Guild[]
  },

  deleteGuild(discordId: string) {
    const stmt = db.prepare('DELETE FROM guilds WHERE discordId = ?');
    return stmt.run(discordId);
  }
}
