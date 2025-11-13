import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, GuildMember, MessageActionRowComponentBuilder, TextChannel, userMention, VoiceChannel } from "discord.js";
import { VoiceController } from "./wave-controller";
import { getMember, setTimeoutAbortable } from "../utils";

// TODO: collect all events of votes and jails
export type UserInteractionState = {
    voteOpenUntil?: number | undefined;
    jailedUntil?: number | undefined;
};

export class InteractionService {
    private abort = new AbortController()
    users = new Map<string, UserInteractionState>();
    channel: TextChannel | VoiceChannel; // assume it's a voicechannel that acts as a text channel for that voice channel
    constructor(channel: TextChannel | VoiceChannel, public controller: VoiceController) {
        this.channel = channel
    }

    isUserJailed(userId: string) {
        const user = this.users.get(userId)
        if(!user) return false;
        return user.jailedUntil > Date.now()
    }

    async jailUser(userId: string, duration: number) {
        const user = await this.getGuildMember(userId)
        const state = this.users.get(userId)
        if (!state) return;
        this.users.set(userId, { ...state, jailedUntil: Date.now() + duration })
        const durationSeconds = Math.floor(duration / 1000);
        this.setMute(user, true, `jailed for ${durationSeconds} seconds`)
        this.channel.send(`${userMention(user.id)} has been muted for ${durationSeconds} seconds.`)
        setTimeoutAbortable(() => {
            this.setMute(user, false, `released after ${durationSeconds} seconds`)
            this.channel.send(`${userMention(user.id)} has been released after ${durationSeconds} seconds.`)
        }, duration, this.abort.signal)
    }

    private async getGuildMember(userId: string) {
        const channelMember= this.channel.members.get(userId);
        if(channelMember) return Promise.resolve(channelMember)
        return getMember(this.channel.guildId, userId)
      }

      private setMute(member: GuildMember, state: boolean, reason?: string) {
          if(member.voice?.channel) {
            const nextState: any = { mute:state }
            if(reason) {
              nextState.reason = reason;
            }
            return member.edit(nextState)
          }
        }

    async sendTurnLimitWarning(channel: TextChannel | VoiceChannel, time: /* ms */ number, member: GuildMember) {
        if (!channel) {
            return
        }
        const confirm = new ButtonBuilder()
            .setCustomId('veto')
            .setLabel('Veto')
            .setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(confirm);

        const secondsLeft = Math.ceil((this.controller.turnTracker.opts.turnLimit - this.controller.turnTracker.opts.votePadding - time) / 1000);
        const msg = `${secondsLeft}s left in ${userMention(member.id)} turn. Veto his automatic extension of ${Math.ceil(this.controller.turnTracker.extensionService.opts.extensionDuration/1000)}s ( Vote lasts for ${Math.floor(time/1000)}s )`
        const warning = await channel.send({ content: msg, components: [row] })
        try {
            let vetoed = false;

            const collector = warning.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: time,
                filter: (i: any) => this.voters.includes(i.user.id)
            })

            collector.on('collect', () => {
                vetoed = true;
                collector.stop()
            });

            this.abort.signal.addEventListener("abort", () => {
                collector.stop()
            })

            return new Promise(async (resolve, reject) => {
                collector.on('end', async () => {
                try {
                    if (vetoed) {
                        const msg = `${userMention(member.id)} you have ${Math.floor(this.controller.turnTracker.opts.votePadding/1000)}s to finish up your turn.`;
                        await warning.edit({ content: msg, components: [] })
                        resolve(true)
                    } else {
                        const msg = `${userMention(member.id)} got an automatic extension of ${Math.ceil(this.controller.turnTracker.extensionService.opts.extensionDuration/1000)}s.`;
                        await warning.edit({ content: msg, components: [] })
                        resolve(false);
                    }
                } catch (error) {
                    reject(error)
                }
                });
            })
        } catch {
            await warning.edit({ content: 'error', components: [] });
            return false
        }
    }

    private async collectVotes(
        time: /*ms*/ number,
        member: GuildMember
      ): Promise<boolean> {
        if (!this.channel) {
          return
        }
        const confirm = new ButtonBuilder()
          .setCustomId('jail')
          .setLabel('Cooldown')
          .setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(confirm);
        // TODO: try catch on prompt
        const msg=`${userMention(member.id)} has been active in this period for more than 75% of the time. ${this.majority} votes needed to force him to cooldown. ( Vote lasts for ${Math.floor(time/1000)}s )`
        const warning = await this.channel.send({ content: msg, components: [row] })
        try {
          let voted = new Set<string>();
          let reachedMajority = false;
          const collector = warning.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: time,
            filter: (i:any) => this.voters.includes(i.user.id)
          })

          collector.on('collect', m => {
            voted.add(m.user.id)
            if (voted.size >= this.majority) {
              reachedMajority = true;
              collector.stop()
            }
          });

          this.abort.signal.addEventListener("abort", () => {
            voted.clear()
            collector.stop()
          })

          return new Promise(async (resolve, reject) => {
            collector.on('end', async () => {
              try {
                if (reachedMajority) {
                  await warning.edit({ content: `Cooldown vote reached majority.`, components: [] })
                  resolve(true)
                } else {
                  await warning.edit({ content: `Cooldown vote didn't reach majority.`, components: [] })
                  resolve(false);
                }
              } catch (error) {
                reject(error)
              }
            });
          })

        } catch {
          await warning.edit({ content: 'error', components: [] });
          return false
        }
      }

    voters: string[] = []
    get majority() {
      return Math.max(1, Math.ceil(this.voters.length / 2))
    }

    handlers = {
        "PERIOD_LIMIT_REACHED": async (event) => {
            this.voters = event.voters.filter(voter => !this.isUserJailed(voter));
            const now = Date.now()
            const state = this.users.get(event.userId)
            const postponeVoteUntil = state ? Math.max(state.jailedUntil || 0, state.voteOpenUntil || 0) : 0;
            if(now > postponeVoteUntil) {
              setTimeoutAbortable(() => {
                this.controller.events.once('PERIOD_LIMIT_REACHED', this.handlers["PERIOD_LIMIT_REACHED"])
            }, this.controller.opts.periodVoteRepeatFrequency, this.abort.signal)
              const time = this.controller.opts.periodVoteDuration
              const offender = await this.getGuildMember(event.userId)
              const jailed = await this.collectVotes(time, offender)
              if(jailed) {
                  this.jailUser(event.userId, this.controller.opts.jailDuration)
              }
            } else {
              const listenAgainAfter = postponeVoteUntil - now
              setTimeoutAbortable(() => {
                this.controller.events.once('PERIOD_LIMIT_REACHED', this.handlers["PERIOD_LIMIT_REACHED"])
            }, listenAgainAfter, this.abort.signal)
            }
        },
        // "PERIOD_LIMIT_WARNING": () => {console.log("PERIOD_LIMIT_WARNING")},
        "TURN_LIMIT_WARNING_VOTE_OPENNED": async (event) => {
            this.voters = event.voters.filter(voter => !this.isUserJailed(voter));

            let state = this.users.get(event.userId)
            if (!state) {
                state = {}
                this.users.set(event.userId, {})
            };
            if (state.jailedUntil > Date.now()) return;
            if (state.voteOpenUntil === event.until) return; // ensures that this handler executes once
            this.users.set(event.userId, { ...state, voteOpenUntil: event.until })
            const member = await this.getGuildMember(event.userId)
            const lastFor = event.until - Date.now();
            const isVetoed = await this.sendTurnLimitWarning(this.channel, lastFor, member)
            if (!isVetoed) {
                this.controller.turnTracker.extensionService.addExtension(event.userId, event.endOfTurn)
                // const ext = this.controller.turnTracker.extensionService.getExtension(event.userId)
                // console.log({...ext, userId: event.userId})
            }
        },
        "TURN_LIMIT_REACHED": (event) => {
            if (Date.now() > event.endOfTurn) { // sanity check, I assume it will always pass
                console.log(event)
                const state = this.users.get(event.userId)
                if (!state) return;
                if (state.jailedUntil > Date.now()) return;
                this.jailUser(event.userId, this.controller.opts.jailDuration)
            }
        }
    }

    removeTurnHandlers() {
        this.controller.events.removeListener('PERIOD_LIMIT_REACHED', this.handlers["PERIOD_LIMIT_REACHED"])
        // this.controller.events.removeListener('PERIOD_LIMIT_WARNING', this.handlers["PERIOD_LIMIT_WARNING"])
        this.controller.events.removeListener('TURN_LIMIT_WARNING_VOTE_OPENNED', this.handlers["TURN_LIMIT_WARNING_VOTE_OPENNED"])
        this.controller.events.removeListener('TURN_LIMIT_REACHED', this.handlers["TURN_LIMIT_REACHED"])
    }

    handleTurnEvent() {
        this.controller.events.once('PERIOD_LIMIT_REACHED', this.handlers["PERIOD_LIMIT_REACHED"])
        // this.controller.events.addListener('PERIOD_LIMIT_WARNING', this.handlers["PERIOD_LIMIT_WARNING"])
        this.controller.events.addListener('TURN_LIMIT_WARNING_VOTE_OPENNED', this.handlers["TURN_LIMIT_WARNING_VOTE_OPENNED"])
        this.controller.events.addListener('TURN_LIMIT_REACHED', this.handlers["TURN_LIMIT_REACHED"])
    }

    unmuteAll() {
        // TODO: check if this fetches all members
        this.channel.members.forEach(member => {
            this.setMute(member, false, 'wave mode init')
        })
    }

    clearJailTimeouts() {
        this.abort.abort()
    }
}