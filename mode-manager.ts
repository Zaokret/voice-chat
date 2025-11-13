// bot.ts
import { APIEmbedField, ChatInputCommandInteraction, EmbedBuilder, GuildMember, orderedList, time, userMention, VoiceChannel, VoiceState } from "discord.js";
import EventEmitter from "events";
import { VoiceChatRoomTracker } from './vc-mod/room-tracker';
import { joinVoiceChannel, VoiceConnection, VoiceConnectionStatus } from '@discordjs/voice';
import { DeafenTracker, SpeakingTracker } from "./vc-mod/speaking-tracker";
import { QueueController } from './vc-mod/queue-mode';
import { ExtensionService } from './vc-mod/wave-extension';
import { TurnTracker } from './vc-mod/wave-turn-tracker';
import { VoiceController } from './vc-mod/wave-controller';
import { InteractionService } from './vc-mod/wave-interaction';
import { PlatformController } from './vc-mod/platform-mode';
import { client } from "./client";
import { mapVoiceStateUpdateToEvents } from "./vc-mod/voice-state-mapper";
import { dashboardEmitter } from "./server";
import { getMember } from "./utils";
import { repository } from "./repository";
import { parseQueueConfig, parseWaveConfig } from "./vc-mod/types";

// TODO: recreate mode manager on disconnect
export type ModerationMode = "queue" | "wave" | "platform" | "passive"
export const modes: { value: ModerationMode, name: string }[] = [
  { name: 'passive', value: 'passive' },
  { name: 'wave', value: 'wave' },
  { name: 'queue', value: 'queue' },
  { name: 'platform', value: 'platform' }
]
export class ModeManager {
  public startedAt = Date.now()
  public changedAt = Date.now()
  private guildId!: string;
  public channel!: VoiceChannel;
  private connection!: VoiceConnection;

  voiceEvents = new EventEmitter()
  private roomTracker!: VoiceChatRoomTracker;
  private speakingTracker!: SpeakingTracker;
  private deafenTracker!: DeafenTracker;

  private voiceStateHandler = (oldState: VoiceState, newState: VoiceState) => {
          if(newState.guild.id === this.guildId) {
            mapVoiceStateUpdateToEvents(
              this.voiceEvents,
              this.connection.joinConfig.channelId!,
              oldState,
              newState
            )
          }
        }

  // wave
  waveTurnOptions!: {
    pauseDuration: number, // ms
    turnLimit: number, // ms
    warningOffset: number, // ms
    votePadding: number, // ms
    extensionDuration: number, // ms
    jailDuration: number // ms
  };
  waveControllerOptions!: {
    jailDuration: number // ms,
    activeUserWeight: number, // constant
    passiveUserWeight: number, // constant
    initialPeriodFactor: number, // constant
    activeUserThreshold: number, // ms
    periodBreathingFactor: number, // constant
    eligibleVoterTimeReq: number, // ms
    extensionDuration: number, // ms
    periodVoteRepeatFrequency: number, // ms,
    periodVoteDuration: number // ms
  }
  waveExtensionService!: ExtensionService;
  waveTurnTracker!: TurnTracker
  waveVoiceController!: VoiceController
  waveInteractionService!: InteractionService

  // queue
  queueController!: QueueController;
  queueOptions!: {
    turnLimit: number, // s
    warningOffset: number, // s
    turnExtension: number, // s
    votePadding: number, // s
    autoNextThreshold: number, // s

  }
  queueHandlers = {
    next: (i: ChatInputCommandInteraction) => {
      const result = this.queueController.next(i.user.id)
      const msg = result ? `${userMention(i.user.id)} ended his turn.` : `You aren't the active speaker.`
      i.editReply(msg)
    },
    wait: (i: ChatInputCommandInteraction) => {
      const result = this.queueController.wait(i.user.id)
      const msg = result ? `${userMention(i.user.id)} waited and now is the last in queue.` : `Finish your turn first.`
      i.editReply(msg)
    },
    join: ({ member }: { member: GuildMember }) => {
      this.queueController.join(member)
      console.log('joined queue')
    },
    leave: ({ member }: { member: GuildMember }) => {
      this.queueController.leave(member)
      console.log('left queue')
    }
  }

  // platform
  platformController!: PlatformController;
  mode: ModerationMode = 'passive'

  constructor(guildId: string) {
    this.guildId = guildId;
    const entity = repository.getGuildByDiscordId(guildId)
    if(!entity) {
      throw Error('Missing guild entity');
    }
    this.waveTurnOptions = parseWaveConfig(entity)
    this.waveControllerOptions =
    {
      activeUserWeight: 0.8,
      passiveUserWeight: 0.2,
      initialPeriodFactor: 2,
      periodBreathingFactor: 1.1,
      activeUserThreshold: 30_000,
      eligibleVoterTimeReq: 30_000,
      jailDuration: this.waveTurnOptions.jailDuration,
      extensionDuration: this.waveTurnOptions.extensionDuration,
      periodVoteRepeatFrequency: this.waveTurnOptions.turnLimit,
      periodVoteDuration: this.waveTurnOptions.turnLimit - this.waveTurnOptions.votePadding
    }
    this.queueOptions = parseQueueConfig(entity)
    console.log(this.waveTurnOptions)
    console.log(this.waveControllerOptions)
    console.log(this.queueOptions)



    this.voiceEvents.on('join', ({ member }: { member: GuildMember }) => {
      if (member.voice?.serverMute) {
        // console.log('global unmute')
        member.edit({ mute: false })
      }
    })
  }


  private async initPlatform(interaction: ChatInputCommandInteraction) {
    const user = interaction.options.getUser("user")
    if(!user) {
      return interaction.editReply('Pick a user on the platform.')
    }
    this.platformController = new PlatformController(this.channel,this.roomTracker, user.id)
    await this.platformController.start()
  }

  private async closePlatform() {
    await this.platformController.end()
  }

  private async initWave(interaction: ChatInputCommandInteraction) {
    // track turn extensions
    this.waveExtensionService = new ExtensionService(
      this.roomTracker.getPresentUsers().map(u => u.userId), this.waveControllerOptions)
    // track the turn of an active speaker, smooth speaking events
    this.waveTurnTracker = new TurnTracker(
      this.waveTurnOptions,
      this.speakingTracker,
      this.deafenTracker,
      this.waveExtensionService)
    // generate events on thresholds for turns and periods: warning, threshold
    this.waveVoiceController = new VoiceController(this.waveControllerOptions, this.waveTurnTracker)
    // send warnings, open votes, add extensions, put in jail
    this.waveInteractionService = new InteractionService(this.channel, this.waveVoiceController)

    this.waveInteractionService.handleTurnEvent()
    this.waveInteractionService.unmuteAll();
    this.waveVoiceController.startSeconds()
    this.waveVoiceController.startPeriod()
  }

  private async closeWave() {
    this.waveInteractionService.clearJailTimeouts()
    this.waveInteractionService.removeTurnHandlers()
    this.waveVoiceController.endSeconds()
    this.waveVoiceController.endPeriod()
  }

  private async closeQueue() {
    await this.queueController.end()
    this.voiceEvents.removeListener("circle_next", this.queueHandlers.next)
    this.voiceEvents.removeListener("circle_wait", this.queueHandlers.wait)
    this.voiceEvents.removeListener('join', this.queueHandlers.join);
    this.voiceEvents.removeListener('leave', this.queueHandlers.leave);
  }

  private async initQueue(interaction: ChatInputCommandInteraction) {
    console.log('Voice chat connection ready!')
    const opts = {
      turnLimit: 30,
      warningOffset: 15, // 30
      turnExtension: 30,
      votePadding: 5,
      autoNextThreshold: 10
    }
    this.queueController = new QueueController(this.queueOptions, this.roomTracker.getPresentUsers(), this.channel, this.speakingTracker)

    this.voiceEvents.on("circle_next", this.queueHandlers.next)
    this.voiceEvents.on("circle_wait", this.queueHandlers.wait)
    this.voiceEvents.on('join', this.queueHandlers.join);
    this.voiceEvents.on('leave', this.queueHandlers.leave);

    await this.queueController.start()
  }

  // TODO: find interaction type
  private init(interaction: ChatInputCommandInteraction) {
    return new Promise<void>((resolve, reject) => {
      this.channel = interaction.options.getChannel("channel", true)
      if (!this.channel || !this.channel.isVoiceBased()) {
        reject("Configured channel not found or not a voice channel.");
      }

      this.connection = joinVoiceChannel({
        channelId: this.channel.id,
        guildId: this.channel.guild.id,
        adapterCreator: this.channel.guild.voiceAdapterCreator,
      });


      this.connection.on(VoiceConnectionStatus.Ready, async () => {
        client.on('voiceStateUpdate', this.voiceStateHandler)
        const presentUsers = Array.from(this.channel.members.filter(m => !m.user.bot).values())
        this.roomTracker = new VoiceChatRoomTracker(...presentUsers)

        this.speakingTracker = new SpeakingTracker(this.connection.receiver, this.roomTracker)
        this.deafenTracker = new DeafenTracker(
          this.roomTracker.getPresentUsers().map(u => ({ userId: u.userId, isDeafen: !u.listen })),
          Date.now())

          setInterval(() => {
      if(this.roomTracker) {
        dashboardEmitter.emit('data', this.roomTracker.getPresentUsers())
      }
    }, 1000)

        resolve()
      })
    })
  }

  private async modeSpecificClose(interaction: ChatInputCommandInteraction, mode: ModerationMode) {
    switch (mode) {
        case "queue": {
          return this.closeQueue()
        }
        case "wave": {
          return this.closeWave()
        }
        case "platform": {
          return this.closePlatform()
        }
        case "passive": {
          return Promise.resolve()
        }
        default: {
          return Promise.reject()
        }
      }
  }

  private async modeSpecificInit(interaction: ChatInputCommandInteraction, mode: ModerationMode) {
    switch (mode) {
        case "queue": {
          return this.initQueue(interaction)
        }
        case "wave": {
          return this.initWave(interaction)
        }
        case "platform": {
          return this.initPlatform(interaction)
        }
        case "passive": {
          return Promise.resolve()
        }
        default: {
          return Promise.reject()
        }
      }
  }

  public async status(interaction: ChatInputCommandInteraction) {
    try {
      const embedHeader = await this.getStatus(interaction)
      const embedFields = await this.modeSpecificStatus(interaction, this.mode)
      embedHeader.addFields(...embedFields)
      interaction.editReply({embeds: [embedHeader]})
    } catch (error) {
      console.log(error)
      if(!interaction.replied)
        interaction.editReply(`Failed to join get status of "${this.channel.name}" channel.`)
    }
  }

  //bot joined
  //speaking and listening activity total ( since mode started )
  //number of interuptions

  private async getStatus(interaction: ChatInputCommandInteraction) {
    return new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`In ${this.mode} mode`)
        .setDescription(`Since ${time(this.startedAt, 'T')}`)
  }

  public async modeSpecificStatus(interaction: ChatInputCommandInteraction, mode: ModerationMode) {
    switch (mode) {
        case "queue": {
          return this.getQueueStatus(interaction)
        }
        case "wave": {
          return this.getWaveStatus(interaction)
        }
        case "platform": {
          return this.getPlatformStatus(interaction)
        }
        case "passive": {
          return Promise.resolve([])
        }
        default: {
          return Promise.reject()
        }
      }
  }

  async getPlatformStatus(interaction: ChatInputCommandInteraction) {
    const member = await getMember(this.guildId, this.platformController.platformUserId)
    const activeUserEF: APIEmbedField = {
      name: 'speaker',
      value: member.displayName
    }
    return [activeUserEF]
  }

  async getWaveStatus(interaction: ChatInputCommandInteraction) {

    const embedFields: APIEmbedField[] = []

    const activeUsers = this.waveTurnTracker.evaluateActiveUsers()
    if(activeUsers.length > 0) {
      const activity = await Promise.all(activeUsers
      .sort((a,b) => b.time - a.time)
      .map(async(user) => {
        const member = await getMember(this.guildId, user.userId)
        return `${member.displayName} ${user.time.toString().padStart(3, ' ')}s of ${Math.floor(this.waveTurnTracker.opts.turnLimit/1000)}s`
      }))

      embedFields.push({
        name: 'activity',
        value: activity.join('\n')
      })
    }

    const jailedUsers = Array.from(this.waveInteractionService.users)
      .filter(([id, state]) => state && state.jailedUntil && state.jailedUntil > Date.now());
    if(jailedUsers.length > 0) {
      const cooldowns = await Promise.all(Array.from(this.waveInteractionService.users)
      .filter(([id, state]) => state && state.jailedUntil && state.jailedUntil > Date.now())
      .map(([id, state]) => {

        const jailTimeLeft = Date.now() - state.jailedUntil!
        const jailTimeElapsed = this.waveInteractionService.controller.opts.jailDuration - jailTimeLeft
        return {id: id, left: jailTimeLeft, elapsed: jailTimeElapsed, total: this.waveVoiceController.opts.jailDuration}
      })
      .sort((a,b) => a.left - b.left)
      .map(async(user) => {
        const member = await getMember(this.guildId, user.id)
        return `${member.displayName} ${Math.floor(user.elapsed/1000).toString().padStart(3, ' ')}s of ${Math.floor(user.total/1000).toString().padStart(4, ' ')}s`
      }))

      embedFields.push({
        name: 'cooldown',
        value: cooldowns.join('\n')
      })
    }

    if(this.waveVoiceController.periods.length > 0) {
      const period = this.waveVoiceController.getPeriodActivityPercentage()
      const periodLength = this.waveVoiceController.periodLength
      const list = await Promise.all(Array.from(period.keys())
        // .filter(id => {
        //   const user = period.get(id)
        //   return user !== undefined && user !== 0;
        // })
        .sort((a,b) => (period.get(b) || 0) - (period.get(a) || 0))
        .map(async (id) => {
          const member = await getMember(this.guildId, id)
          return `${member.displayName} ${(period.get(id) || 0).toString().padStart(2, ' ')}% of ${Math.floor(periodLength/1000).toString().padStart(4,' ')}s`
        }))
      embedFields.push({
        name: 'period',
        value: list.join('\n')
      })
    } else {
      embedFields.push({
        name: 'period',
        value: `conversation must last at least ${Math.floor(this.waveVoiceController.periodLength/1000)}s`
      })
    }

    const voters = this.roomTracker.getEligibleVoters(
      this.waveVoiceController.opts.eligibleVoterTimeReq,
      this.waveTurnTracker.deafenTracker)
    if(voters.length > 0) {
      const voterMembers = await Promise.all(voters.map((id) => getMember(this.guildId, id)))
      embedFields.push({
        name: 'voters',
        value: voterMembers.map((member) => member.displayName).join('\n')
      })
    } else {
      embedFields.push({
        name: 'voters',
        value: `listen for at least ${Math.floor(this.waveVoiceController.opts.eligibleVoterTimeReq/1000)}s`
      })
    }

    return embedFields;
  }

  async getQueueStatus(interaction: ChatInputCommandInteraction) {
    const members = await Promise.all(this.queueController.queue.all()
    .map(({ userId }) => getMember(this.guildId, userId)))

    const timeUntilNextTurn = this.queueController.clock.milestoneManager.timeUntilNext() || 0;
    const activeUserEF: APIEmbedField = {
      name: members[0].displayName,
      value: `${this.queueController.clock.elapsed}s of ${1+timeUntilNextTurn+this.queueController.clock.elapsed}s`
    }

    const orderedListEF: APIEmbedField = {
      name: 'order',
      value: orderedList(members.map(member => member.displayName).slice(1), 2)
    }

    return [activeUserEF, orderedListEF]
  }

  public async join(interaction: ChatInputCommandInteraction, mode: ModerationMode) {
    try {
      await this.init(interaction)
      await this.modeSpecificInit(interaction, mode)
      this.mode = mode;
      await interaction.editReply(`Joined "${this.channel.name}" in ${mode} mode.`)
    } catch (error) {
      console.log(error)
      await interaction.editReply(`Failed to join "${this.channel.name}" in ${mode} mode.`)
    }
  }

  public async end(interaction: ChatInputCommandInteraction) {
    if(this.mode !== 'passive') {
      this.switch(interaction, "passive")
    }
    client.removeListener('voiceStateUpdate', this.voiceStateHandler)
    this.connection.disconnect()
    this.connection.destroy()
  }

  public async switch(interaction: ChatInputCommandInteraction, to: ModerationMode) {
    try {
      await this.modeSpecificClose(interaction, this.mode)
      await this.modeSpecificInit(interaction, to)
      this.changedAt = Date.now()
      interaction.editReply(`Switched "${this.channel.name}" from ${this.mode} to ${to}.`)
      this.mode=to;
    } catch (error) {
      if(!interaction.replied)
        interaction.editReply(`Failed to switch "${this.channel.name}" from ${this.mode} to ${to}.`)
    }
  }
}