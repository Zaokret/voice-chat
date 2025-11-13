import { TimeEvent, UserHistory } from "./types";
import { VoiceChatRoomTracker } from "./room-tracker";
import EventEmitter from "node:events";
import { VoiceReceiver } from "@discordjs/voice";

export class DeafenTracker {
  public users = new Map<string, UserHistory>();
  constructor(
    users: Array<{ userId: string, isDeafen: boolean }>,
    public startedAt = Date.now()) {
    users.forEach(user => {
      if(user.isDeafen) {
        this.start(user.userId)
      } else {
        this.users.set(user.userId, { events: [] })
      }
    })
  }

  private start(userId: string) {
    console.log(`${userId} deafened`)
    const now = Date.now()
    const history = this.users.get(userId) || { events: [] }
    let event: TimeEvent = { start: now, end: null }
    this.users.set(userId, { events: history.events.concat(event) })
  }

  private end(userId: string) {
    console.log(`${userId} undeafened`)
    const now = Date.now()
    const history = this.users.get(userId)
    if(history) {
      history.events[history.events.length-1].end = now;
      this.users.set(userId, { events: history.events })
    }
  }

  public attach(events: EventEmitter) {
    events.on('listenable', ({user}) => {
      this.end(user.id)
    })
    events.on('unlistenable', ({user}) => {
      this.start(user.id)
    })
  }

  getUserEvents(userId: string) {
    return this.getEventsInRange(userId, this.startedAt, Date.now())
  }

  getEventsInRange(userId: string, from: number, to: number) {
    const history = this.users.get(userId);
    if (!history) return []
    return history.events.filter(event => event.start > from && event.end < to)
  }

  getDeafenedTime(userId: string) {
    return this.getDeafenedTimeInRange(userId, this.startedAt, Date.now());
  }

  getListeningTime(userId: string) {
    const duration = Date.now() - this.startedAt;
    const time = this.getDeafenedTimeInRange(userId, this.startedAt, Date.now());
    return duration - time;
  }

  getListeningTimeInRange(userId: string, from: number, to: number) {
    const duration = to - from;
    const time = this.getDeafenedTimeInRange(userId, from, to)
    return duration - time;
  }

  getDeafenedTimeInRange(userId: string, from: number, to: number) {
    const now = Date.now();
    const history = this.users.get(userId);
    if (!history) return 0;

    let total = 0;

    for (const ev of history.events) {
      const start = Math.max(ev.start, from);
      const end = ev.end ? Math.min(ev.end, to) : Math.min(now, to);
      if (end > start) {
        total += end - start;
      }
    }

    return total;
  }
}

export type Interuption = {
  timestamp: number;
  interuptor: string;
  interupted: string[];
}

export class SpeakingTracker {
  public users = new Map<string, UserHistory>();
  public interuptions = new Map<string, Interuption[]>()


  private startedAt = Date.now()
  constructor(private receiver: VoiceReceiver, public vcTracker: VoiceChatRoomTracker) {
    for (const [id, state] of this.vcTracker.users) {
      if(state && state.present) {
        this.users.set(id, { events: [] })
      }
    }

    this.attach();
  }

  private attach() {
    this.receiver.speaking.on('start', (userId) => {
      // const state = this.vcTracker.getUserState(userId)
      // if (state && state.present && state.speak) {
        console.log('start ', userId)
        const now = Date.now();
        const history = this.users.get(userId) || { events: [] };
        history.events.push({ start: now, end: null });
        this.users.set(userId, history);

        const interupted = this.findInterupted(userId)
        if(interupted.length > 0) {
          this.addInteruption(userId, interupted)
        }
      // }
    });

    this.receiver.speaking.on('end', (userId) => {
      const now = Date.now();
      const history = this.users.get(userId);
      if (!history) return;
      const lastEvent = history.events[history.events.length - 1];
      console.log(`end ${userId} after ${now - lastEvent.start}`)
      if (lastEvent && lastEvent.end === null) {
        lastEvent.end = now;
      }
    });
  }

  getSpeakingTimeFromEvents(events: TimeEvent[]) {
    let total = 0;
    for (const ev of events) {
      if (ev.end > ev.start) {
        total += ev.end - ev.start;
      }
    }
    return total;
  }

  getAbsoluteRange(userId: string, from: number, to: number) {
    const now = Date.now();
    const history = this.users.get(userId);
    if (!history) return [];

    let events: TimeEvent[] = [];

    for (const ev of history.events) {
      if(ev.end && ev.end < from) {
        continue
      };
      if(ev.start > to) {
        continue
      };
      events.push({
        end: Math.min(to, ev.end || now),
        start: Math.max(from, ev.start)
      })
    }
      return events;
  }

  getUserEvents(userId: string) {
    return this.getEventsInRange(userId, this.startedAt, Date.now())
  }

  getEventsInRange(userId: string, from: number, to: number) {
    const history = this.users.get(userId);
    if (!history) return []
    return history.events.filter(event => event.start > from && event.end < to)
  }

  getSpeakingTime(userId: string) {
    return this.getSpeakingTimeInRange(userId, this.startedAt, Date.now());
  }

  getSpeakingTimeInRange(userId: string, from: number, to: number) {
    const now = Date.now();
    const history = this.users.get(userId);
    if (!history) return 0;

    let total = 0;

    for (const ev of history.events) {
      const start = Math.max(ev.start, from);
      const end = ev.end ? Math.min(ev.end, to) : Math.min(now, to);
      if (end > start) {
        total += end - start;
      }
    }

    return total;
  }

  /**
   * for all currently present users return total time spoken since the begining of the call
   */
  getTotalTimeSpokenSinceStart() {
    const hash = {}
    for (const [id, state] of this.vcTracker.users) {
      if (state.present) {
        const time = this.getSpeakingTime(id)
        hash[id] = time;
      }
    }
    return hash;
  }

  private addInteruption(interuptor: string, interupted: string[]) {
    const timestamp = Date.now()
    const arr = this.interuptions.get(interuptor)
    this.interuptions.set(interuptor, (arr || []).concat({ timestamp, interupted, interuptor }))
  }

  private findInterupted(interuptor: string) {
    let interupted: string[] = []
    for (const [id, { events }] of this.users) {
      if(interuptor === id) {
        continue;
      }

      const state = this.vcTracker.getUserState(id)
      if(!state || !state.present || !state.speak) {
        continue;
      }

      if(events.length > 0 && events[events.length-1].end === null) {
        interupted.push(id)
      }
    }
    return interupted;
  }
}

