import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, GuildMember, MessageActionRowComponentBuilder, TextChannel, userMention, VoiceChannel } from "discord.js";
import { EventEmitter } from "events";
import { SpeakingTracker } from "./speaking-tracker";
import { getMember } from '../utils';
function shuffle<T>(array: T[]): T[] {
  let m = array.length
  let i = 0;

  while (m) {
    i = Math.floor(Math.random() * m--);
    [array[m], array[i]] = [array[i], array[m]];
  }

  return array;
}

type milisecond = number;
type second = number;
type timestamp = number;

type EventPayload = {}
type CounterEvent = {
  "tick": [EventPayload],
  "preMilestone": [EventPayload],
  "milestone": [EventPayload],
  "end": [EventPayload],
  "milestoneExtended": [EventPayload]
}
type MilestoneRecord = {
  start: timestamp;
  end: timestamp;
  duration: second;
}
type MilestoneOptions = {
  milestone: second;
  preMilestoneOffset: second;
  milestoneExtension: second;
}

class MilestoneManager {
  history: MilestoneRecord[] = [];
  milestone: number[] = [];

  constructor(time: second) {
    this.set(time);
  }

  // Get the current upcoming milestone absolute time
  get() {
    return this.milestone[0];
  }

  // Add a new milestone after the previous one
  set(time: second): void {
    const now = Date.now();
    const lastMilestoneEnd = this.milestone.length
      ? this.milestone.shift()
      : now;

    const newMilestone = lastMilestoneEnd + time * 1000;
    this.milestone.push(newMilestone);

    // Update history
    this.history.push({
      start: lastMilestoneEnd,
      end: newMilestone,
      duration: time,
    });
  }

  // end prematurelly
  fastForward(time: second) {
    const now = Date.now();
    const lastMilestoneEnd = now
    this.milestone.shift()

    const newMilestone = now + time * 1000;
    this.milestone.push(newMilestone);

    // rewrite last history event
    const lastHistoryEvent = this.history.pop()
    lastHistoryEvent.end = now;
    lastHistoryEvent.duration = Math.floor((now - lastHistoryEvent.start) / 1000)
    this.history.push(lastHistoryEvent)
    // Update history
    this.history.push({
      start: lastMilestoneEnd,
      end: newMilestone,
      duration: time,
    });
  }

  // Extend the current upcoming milestone by X seconds
  extend(time: second): void {
    if (!this.milestone.length) return;

    this.milestone[0] += time * 1000; // extend in ms

    const last = this.history[this.history.length - 1];
    this.history[this.history.length - 1] = {
      start: last.start,
      end: last.end + time * 1000,
      duration: last.duration + time,
    };
  }

  clear() {
    this.milestone = [];
  }

  timeUntilNext(): second | null {
    if (!this.milestone.length) return null;
    return Math.max(0, Math.floor((this.milestone[0] - Date.now()) / 1000));
  }
}

class Counter extends EventEmitter<CounterEvent> {
  startedAt: timestamp = 0;
  elapsed: second = 0;
  private timer: NodeJS.Timeout | null = null;
  public milestoneManager: MilestoneManager;

  constructor(public opts: MilestoneOptions) {
    super()
  }

  extendNextMilestone() {
    this.milestoneManager.extend(this.opts.milestoneExtension)
    this.emit("milestoneExtended", {});
  }

  forceMilestone() {
    this.milestoneManager.fastForward(this.opts.milestone)
    this.startedAt = Date.now()
    this.elapsed = 0;
    this.emit("milestone", {});
  }

  handleInterval() {
    this.elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    this.emit("tick", {});

    const timeLeft = this.milestoneManager.timeUntilNext()
    if (timeLeft === null) return;

    if (timeLeft === 0) {
      this.milestoneManager.set(this.opts.milestone)
      this.emit("milestone", {});
      return;
    }

    if (timeLeft - this.opts.preMilestoneOffset === 0) {
      this.emit("preMilestone", {});
      return
    }
  }

  start(interval = 1000) {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.elapsed = 0;
    this.milestoneManager = new MilestoneManager(this.opts.milestone)
    this.timer = setInterval(() => {
      this.handleInterval()
    }, interval);
  }

  end() {
    if (!this.timer) return;

    clearInterval(this.timer);
    this.timer = null;
    this.elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    this.emit("end", {});
  }
}

export class QueueController {
  public isActive = false;
  private reason = 'auto-mod mode: circle';
  public clock: Counter;
  public queue: Queue<{ userId: string }>;
  private abort = new EventEmitter()
  constructor(public opts: {
    turnLimit: second,
    warningOffset: second,
    turnExtension: second,
    votePadding: second,
    autoNextThreshold: second
  }, arr: Array<{ userId: string }>,
    private channel: TextChannel | VoiceChannel,
    private speakingTracker: SpeakingTracker) {
    this.clock = new Counter({
      milestone: this.opts.turnLimit,
      milestoneExtension: this.opts.turnExtension,
      preMilestoneOffset: this.opts.warningOffset,
    })
    this.queue = new Queue(arr)
    this.handleClockEvents()
  }

  private async collectVotes(
    time: second,
    currentSpeaker: { userId: string },
  ): Promise<boolean> {
    if (!this.channel) {
      return
    }
    const confirm = new ButtonBuilder()
      .setCustomId('ext')
      .setLabel('Extend')
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>()
      .addComponents(confirm);
    // TODO: try catch on prompt
    const secondsLeft = this.opts.turnLimit - this.opts.votePadding - Math.ceil(time/1000)
    const msg = `${secondsLeft}s left in ${userMention(currentSpeaker.userId)} turn. ${this.majority} votes needed to extend their turn by ${this.opts.turnExtension}s ( Vote lasts for ${Math.floor(time/1000)}s )`
    const warning = await this.channel.send({ content: msg, components: [row] })
    try {
      let voted = new Set<string>();
      // need to keep track this manually because majority can change between collector.stop() and collector end handler
      let reachedMajority = false
      const collector = warning.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: time,
        filter: (i: any) => this.voters.includes(i.user.id)
      })

      collector.on('collect', m => {
        if (m.component.customId === 'ext') { console.log('ext button pressed'); }
        voted.add(m.user.id)
        if (voted.size >= this.majority) {
          reachedMajority = true
          collector.stop()
        }
      });

      this.abort.once("abort", () => {
        voted.clear()
        collector.stop()
      })

      return new Promise(async (resolve, reject) => {
        collector.on('end', async () => {
          try {
            if (reachedMajority) {
              const msg = `${userMention(currentSpeaker.userId)} turn is extended for ${this.opts.turnExtension} seconds.`;
              await warning.edit({ content: msg, components: [] })
              resolve(true)
            } else {
              const msg = `${userMention(currentSpeaker.userId)} turn will end in ${this.opts.votePadding} seconds.`;
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

  voters: string[] = []

  get majority() {
    return Math.max(1, Math.ceil(this.voters.length / 2))
  }

  private handleClockEvents() {
    this.clock.addListener("preMilestone", async () => {
      if (this.queue.length > 1) {
        console.log('preMilestone')
        const voteDuration = this.opts.warningOffset - this.opts.votePadding;
        const majorityVote = await this.collectVotes(voteDuration * 1000, this.queue.first())
        if (majorityVote) {
          this.clock.extendNextMilestone()
        }
      }
    })
    this.clock.addListener("milestone", async () => {
      if (this.queue.length > 1) {
        console.log('milestone')
        const curr = await this.getGuildMember(this.queue.array[0].userId)
        const next = await this.getGuildMember(this.queue.array[1].userId)
        await this.setMute(curr, true, this.reason)
        await this.setMute(next, false, this.reason)

        this.queue.cycle()
      }
    })

    this.clock.addListener("tick", () => {
      this.voters = this.queue.array.filter(item => item.userId !== this.queue.first().userId).map(user => user.userId)
      const active = this.queue.first()
      console.log(`active: ${active.userId}`)

      const now = Date.now()
      const events = this.speakingTracker.getAbsoluteRange(active.userId, this.clock.startedAt, now)
      // console.log({elapsed: this.clock.elapsed, threshold: this.opts.autoNextThreshold, events, total: this.speakingTracker.getUserEvents(active.userId).length})
      const msg = `Auto-next after ${userMention(active.userId)} had ${this.opts.autoNextThreshold} seconds of innactivity.`;
      if (events.length === 0 && this.clock.elapsed >= this.opts.autoNextThreshold) {
        this.next(active.userId)
        this.channel.send(msg)
      } else if (events.length > 0) { // stopped speaking and silence duration hit the threshold
        const lastEvent = events[events.length - 1]
        if (lastEvent.end) {
          const timeSinceLastSpeakingEvent = Math.floor((now - lastEvent.end) / 1000);
          if (timeSinceLastSpeakingEvent >= this.opts.autoNextThreshold) {
            this.next(active.userId)
            this.channel.send(msg)
          }
        }
      }
    })
  }

  public next(userId: string): boolean {
    if (userId === this.queue.first().userId) {
      this.abort.emit('abort')
      this.clock.forceMilestone()
      console.log('next')
      return true;
    }
    return false;
  }

  public wait(userId: string): boolean {
    if (userId === this.queue.first().userId) {
      return false;
    }
    this.queue.wait(userId)
    return true;
  }

  private async getGuildMember(userId: string) {
    const channelMember = this.channel.members.get(userId);
    if (channelMember) return Promise.resolve(channelMember)
    return getMember(this.channel.guildId, userId)
  }

  public async start(reason?: string) {
    if (this.queue.length > 1) {
      console.log('starting queue...')
      const active = this.queue.first();
      // TODO: try catch
      const result = await Promise.all(this.queue.all().map(async ({ userId }) => {
        const member = await this.getGuildMember(userId)
        if (member.id !== active.userId) {
          return this.setMute(member, true, 'auto-mod mode: circle')
        } else {
          return this.setMute(member, false, 'auto-mod mode: circle')
        }
      }))
      this.clock.start()
      if (reason) {
        this.channel.send(reason)
      }
    }
  }

  public async end(reason?: string) {
    console.log('ending queue')
    this.clock.end()
    // TODO: try catch
    const result = await Promise.all(this.queue.all().map(async ({ userId }) => {
      const member = await this.getGuildMember(userId)
      return this.setMute(member, false, 'auto-mod mode: circle ended')
    }))

    if (reason) {
      this.channel.send(reason)
    }
    // this.clock
    //   .removeAllListeners("preMilestone")
    //   .removeAllListeners("milestone")
    //   .removeAllListeners('tick')
  }

  // TODO: tell max that he needs to use role for server mute
  private setMute(member: GuildMember, state: boolean, reason?: string) {
    if (member.voice?.channel) {
      if (member.voice.serverMute === state) {
        console.log('already in the correct mute state')
        return member;
      }
      const nextState: any = { mute: state }
      if (reason) {
        nextState.reason = reason;
      }
      return member.edit(nextState)
    }
  }

  public async join(member: GuildMember) {
    this.queue.add({ userId: member.id })
    // console.log(this.queue.all())
    if (this.queue.length === 2) {
      await this.start(`Queue continues now that there is enough users.`)
    } else if (this.queue.length > 2) {
      await this.setMute(member, true, 'auto-mod mode: circle; joined voice channel')
    }
  }
  public async leave(member: GuildMember) {
    await this.setMute(member, false, 'auto-mod left voice channel')
    if (this.queue.first().userId === member.id) {
      this.queue.cycle()
      this.queue.remove(member.id)
      this.abort.emit('abort')
      this.clock.milestoneManager?.fastForward(this.clock.opts.milestone)
      const next = await this.getGuildMember(this.queue.first().userId)
      await this.setMute(next, false, '')
    } else {
      this.queue.remove(member.id)
    }
    // console.log(`${this.queue.length} users in queue.`)
    if (this.queue.length <= 1) {
      this.end(`Queue temporarily stopped until another user joins.`)
    }
  }
}

class Queue<T extends { userId: string }> {
  array: T[] = []
  constructor(items: T[]) {
    this.array = [...items];
  }

  public first() {
    return this.array[0];
  }

  public position(userId: string) {
    return this.array.findIndex(item => item.userId === userId);
  }

  public add(...items: T[]) {
    if (items.length === 0) return;
    this.array.push(...items);
  }

  public remove(userId: string) {
    this.array = this.array.filter(item => item.userId !== userId);
  }

  public cycle() {
    const items = this.pull(1);
    if (items.length) {
      this.add(...items);
    }
  }

  public wait(userId: string) {
    const index = this.array.findIndex(item => item.userId === userId);
    if (index >= 1) {
      const temp = this.array.slice();
      const removed = temp.splice(index, 1);
      const result = temp.concat(removed)
      this.array = result;
    }
  }

  public all() {
    return [...this.array];
  }

  public get length() {
    return this.array.length;
  }

  private pull(count = 1) {
    const pulled = this.array.splice(0, count);
    return pulled;
  }
}