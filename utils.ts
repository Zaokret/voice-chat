import { ChannelType, ChatInputCommandInteraction, Collection, GuildBasedChannel, OAuth2Guild } from "discord.js";
import { client } from "./client";
import { getVoiceConnection, joinVoiceChannel } from "@discordjs/voice";
export async function hasRole(interaction: ChatInputCommandInteraction, roleId: string) {

  const member = interaction.member ?? await getMember(interaction.guildId, interaction.user.id)
  if(Array.isArray(member.roles)) {
    return member.roles.includes(roleId)
  }
  else {
    return member.roles.cache.has(roleId);
  }
}

export function setTimeoutAbortable(
  fn: (...args: any[]) => void,
  delay: number,
  signal?: AbortSignal,
  ...args: any[]
): NodeJS.Timeout {
  const id = setTimeout(fn, delay, ...args);

  if (signal) {
    if (signal.aborted) {
      clearTimeout(id);
    } else {
      signal.addEventListener('abort', () => clearTimeout(id), { once: true });
    }
  }

  return id;
}

export async function sleep(ms = 1000) {
  return new Promise<void>((resolve,_) => {
    setTimeout(() => resolve(), ms)
  })
}

export async function leaveAllVoiceChannels(allGuilds: Collection<string, OAuth2Guild>) {


  await Promise.all(
    Array.from(allGuilds).map(async ([guildId, guildPreview]) => {
      try {
        const guild = await guildPreview.fetch();

        const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!me) return;

        const voiceChannelId = me.voice?.channelId;
        if (!voiceChannelId) return;

        const existingConnection = getVoiceConnection(guild.id);
        if (existingConnection) {
          existingConnection.destroy();
          return;
        }

        const channel = await guild.channels.fetch(voiceChannelId);
        if (channel?.isVoiceBased()) {
          const conn = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
          });
          conn.destroy();
        }
      } catch (err) {
        console.error(`Failed to clean up guild ${guildId}:`, err);
      }
    })
  );
}

export async function getGuild(guildId: string) {
  const cached = client.guilds.cache.get(guildId);
  if(cached) {
    return Promise.resolve(cached)
  }
  return client.guilds.fetch(guildId)
}

export async function getMember(guildId: string, userId: string) {
    const guild = await getGuild(guildId)
    const cached = guild.members.cache.get(userId)
    if(cached) {
        return Promise.resolve(cached)
    }
    return guild.members.fetch(userId)
}

export function getTextOfVoiceChannel(guildId: string, voiceChannelId: string): GuildBasedChannel | undefined {
  return client.guilds.cache.get(guildId)?.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildText &&
      ch.id === voiceChannelId
  );
}
