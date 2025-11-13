// bot.ts
import { REST, Routes } from "discord.js";
import { client } from "./client";
import { commands } from "./commands";
import { ModeManager, ModerationMode } from "./mode-manager";
import { hasRole, leaveAllVoiceChannels } from "./utils";
import { defaultConfig, repository } from "./repository";

// ==== CONFIG ====
const TOKEN = process.env.DISCORD_TOKEN!
console.log(TOKEN)
const CLIENT_ID = process.env.DISCORD_CLIENT_ID!
const BOT_OWNER_ID = process.env.BOT_OWNER_ID!
const guildMods = new Map<string, ModeManager>()

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands(guildId: string) {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
    console.log(`Slash command registered in guild ${guildId}`);
  } catch (error) {
    console.log(`Failed to register slash commands in guild ${guildId}`);
  }
}

client.on("interactionCreate", async (interaction) => {
  if(!interaction.guildId) return;
  if (!interaction.isChatInputCommand()) return;
  try {
  if (interaction.commandName === 'leave') {
      await interaction.deferReply()
      const entity = repository.getGuildByDiscordId(interaction.guildId)
      if(!entity || entity.roleId === null) {
        return await interaction.editReply('Guild owner needs to run "/used_by" command first.')
      }
      const authorized = await hasRole(interaction, entity.roleId)
      if(!authorized) {
        return await interaction.editReply(`You don't have the permission to run this command.`)
      }
      const mod = guildMods.get(interaction.guildId)
      if(!mod) {
        return await interaction.editReply(`Bot left a voice channel.`)
      }
      await mod.end(interaction)
      guildMods.delete(interaction.guildId)
      return await interaction.editReply(`Bot left a voice channel.`)
  }
  if (interaction.commandName === "join") {
    await interaction.deferReply()
    const entity = repository.getGuildByDiscordId(interaction.guildId)
    if(!entity || entity.roleId === null) {
      return await interaction.editReply('Guild owner needs to run "/used_by" command first.')
    }
    const authorized = await hasRole(interaction, entity.roleId)
    if(!authorized) {
      return await interaction.editReply(`You don't have the permission to run this command.`)
    }
    const mod = guildMods.get(interaction.guildId)
    if(mod) {
      return await interaction.editReply(`Bot already running in ${mod.channel.name}. Execute /leave command first.`)
    }
    const newMod = new ModeManager(interaction.guildId)
    const mode = interaction.options.getString("mode", true) as ModerationMode
    await newMod.join(interaction, mode)
    guildMods.set(interaction.guildId, newMod)
  }
  if (interaction.commandName === "switch") {
    await interaction.deferReply()
    const entity = repository.getGuildByDiscordId(interaction.guildId)
    if(!entity || entity.roleId === null) {
      return await interaction.editReply('Guild owner needs to run "/used_by" command first.')
    }
    const authorized = await hasRole(interaction, entity.roleId)
    if(!authorized) {
      return await interaction.editReply(`You don't have the permission to run this command.`)
    }
    const mod = guildMods.get(interaction.guildId)
    if(!mod) {
      return await interaction.editReply('Voice mod bot not in any channel yet.')
    }
    const mode = interaction.options.getString("mode", true) as ModerationMode
    if(mode === mod.mode) {
      return await interaction.editReply(`Bot is already in ${mode} mode. Pick another one.`)
    }
    return mod.switch(interaction, mode)
  }
  if (interaction.commandName === "next") {
    await interaction.deferReply()
    const mod = guildMods.get(interaction.guildId)
    if(!mod) {
      return await interaction.editReply('Voice mod bot not in any channel yet.')
    }
    if(mod.mode !== 'queue') {
      return await interaction.editReply('This command makes sense only in queue mode.')
    }
    return mod.voiceEvents.emit("circle_next", interaction)
  }
  if (interaction.commandName === "wait") {
    await interaction.deferReply()
    const mod = guildMods.get(interaction.guildId)
    if(!mod) {
      return await interaction.editReply('Voice mod bot not in any channel yet.')
    }
    if(mod.mode !== 'queue') {
      return await interaction.editReply('This command makes sense only in queue mode.')
    }
    return mod.voiceEvents.emit("circle_wait", interaction)
  }
  if (interaction.commandName === "update") {
    await interaction.deferReply()
    if(interaction.user.id !== BOT_OWNER_ID) {
      return await interaction.editReply(`You don't have the permission to run this command.`)
    }
    await registerCommands(interaction.guildId)
    await interaction.editReply("Update complete.")
  }
  if (interaction.commandName === 'status') {
    await interaction.deferReply()
    const mod = guildMods.get(interaction.guildId)
    if(!mod) {
      return await interaction.editReply('Voice mod bot not in any channel yet.')
    }
    return await mod.status(interaction)
  }
  if (interaction.commandName === 'used_by') {
    await interaction.deferReply()
    if(interaction.guild?.ownerId !== interaction.user.id) {
      return await interaction.editReply('Command can only be run by guild owner.')
    }
    const role = interaction.options.getRole('role', true)
    const entity = repository.getGuildByDiscordId(interaction.guildId)
    if(entity) {
      repository.updateGuild(interaction.guildId, { roleId: role.id })
    } else {
      repository.createGuild(interaction.guildId, { roleId: role.id })
    }
    await interaction.editReply(`Bot can now be used by users with "${role.name}" role.`);
  }
  if (interaction.commandName === 'config') {
    await interaction.deferReply()
    const entity = repository.getGuildByDiscordId(interaction.guildId)
    if(!entity || entity.roleId === null) {
      return await interaction.editReply('Guild owner needs to run "/used_by" command first.')
    }
    const authorized = await hasRole(interaction, entity.roleId)
    if(!authorized) {
      return await interaction.editReply(`You don't have the permission to run this command.`)
    }
    const mod = guildMods.get(interaction.guildId)
    if(mod) {
      return await interaction.editReply(`Can't change configuration while the bot is running inside voice chat.`)
    }
    const mode = interaction.options.getString('mode', true) as 'wave' | 'queue'
    const input = {
      [`${mode}_turn`]: interaction.options.getNumber('turn', false),
      [`${mode}_extension`]: interaction.options.getNumber('extension', false),
      [`${mode}_vote`]: interaction.options.getNumber('vote', false),
      [`${mode}_result`]: interaction.options.getNumber('result', false),
      [`${mode}_pause`]: interaction.options.getNumber('pause', false),
      [`${mode}_jail`]: interaction.options.getNumber('jail', false)
    }
    if(Object.entries(input).every(([_, val]) => val === null)) {
      return await interaction.editReply(`Configuration unchanged.`)
    }

    repository.updateGuild(interaction.guildId, input)
    return await interaction.editReply(`Configuration successfully updated.`);
  }
  } catch (error) {
    console.log(error)
    return await interaction.editReply(`Unknown error while executing command.`)
  }
  /*
  todo:
    mute, unmute commands for testing
    unmute all command
    help
    commands
    docs
    passive limit accumulation
    platform questions queue
    jail exponential
    extension cap?
  */

})

// TODO: graceful shutdown with recoverable states
client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  const allGuilds = await client.guilds.fetch();
  leaveAllVoiceChannels(allGuilds);
  allGuilds.forEach((guild) => {
    registerCommands(guild.id);
    repository.createGuild(guild.id, defaultConfig)
  })

});

client.on('guildCreate', (guild) => {
  registerCommands(guild.id)
  repository.createGuild(guild.id, defaultConfig)
})

client.on('guildDelete', guild => {
  console.log(`Bot was removed from guild: ${guild.name} (${guild.id})`);
  repository.deleteGuild(guild.id)
});

// ==== START ====
// server.listen(3000, () => console.log(server.address()));

client.login(TOKEN)