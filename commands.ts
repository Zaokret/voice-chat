import { ChannelType, SlashCommandBuilder } from "discord.js";
import { modes } from "./mode-manager";

const joinCMD = new SlashCommandBuilder()
    .setName("join")
    .setDescription("Invite voice moderation bot.")
    .addChannelOption(option =>
        option
            .setName('channel')
            .setDescription('The voice channel to join')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildVoice)
    )
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('Voice moderation mode.')
        .setChoices(modes)
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('User on the platform.')
    );

const switchCMD = new SlashCommandBuilder()
    .setName("switch")
    .setDescription("Switch mode of a voice moderation bot.")
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('Voice moderation mode.')
        .setChoices(modes)
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('User on the platform.')
    );

const nextCMD = new SlashCommandBuilder()
    .setName("next")
    .setDescription("Active speaker gives up his turn in a mode: circle.");
const waitCMD = new SlashCommandBuilder()
    .setName("wait")
    .setDescription("Innactive speaker moves to the end of the queue in a mode: circle.");

const updateCMD = new SlashCommandBuilder()
.setName('update')
.setDescription("Update bot slash commands.")

const statusCMD = new SlashCommandBuilder()
.setName('status')
.setDescription("Get info about group mode and stats.")

const usedByCMD = new SlashCommandBuilder()
.setName('used_by')
.setDescription('Necessary setup step.')
.addRoleOption(opt =>
      opt
        .setName('role')
        .setDescription('Role of the users that can invite the bot into VC and switch modes.')
        .setRequired(true)
      );

const configCMD = new SlashCommandBuilder()
.setName('config')
.setDescription('Change configuration field in one of the modes.')
.addStringOption(opt =>
  opt
    .setName('mode')
    .setDescription('Mode of the configuration you want to change.')
    .setChoices([
      { name: 'wave', value: 'wave' },
      { name: 'queue', value: 'queue' }
    ])
    .setRequired(true)
)
.addNumberOption((opt) =>
  opt
    .setName('turn')
    .setDescription('Second duration of a turn.')
    .setMinValue(15)
    .setMaxValue(300)
    .setRequired(false)
)
.addNumberOption((opt) =>
  opt
    .setName('extension')
    .setDescription('Second duration of the turn extension')
    .setMinValue(15)
    .setMaxValue(300)
    .setRequired(false)
)
.addNumberOption((opt) =>
  opt
    .setName('vote')
    .setDescription('Second duration of the vote.')
    .setMinValue(15)
    .setMaxValue(300)
    .setRequired(false)
)
.addNumberOption((opt) =>
  opt
    .setName('result')
    .setDescription('Second duration of the vote result notification.')
    .setMinValue(15)
    .setMaxValue(300)
    .setRequired(false)
)
.addNumberOption((opt) =>
  opt
    .setName('pause')
    .setDescription('Second duration of a pause that ends the turn automatically.')
    .setMinValue(1)
    .setMaxValue(10)
    .setRequired(false)
)
.addNumberOption((opt) =>
  opt
    .setName('jail')
    .setDescription('Second duration of a cooldown punishment.')
    .setMinValue(15)
    .setMaxValue(300)
    .setRequired(false)
)

const leaveCMD = new SlashCommandBuilder()
.setName('leave')
.setDescription('Leave the current voice channel.')

export const commands = [
  joinCMD,
  switchCMD,
  nextCMD,
  waitCMD,
  updateCMD,
  statusCMD,
  usedByCMD,
  configCMD,
  leaveCMD
].map(cmd => cmd.toJSON());
