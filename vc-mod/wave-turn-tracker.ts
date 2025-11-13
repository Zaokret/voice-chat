import { DeafenTracker, SpeakingTracker } from "./speaking-tracker";
import { TimeEvent, ActiveTurnUser } from "./types";
import { ExtensionService } from "./wave-extension";

export class TurnTracker {
  constructor(
    public opts: {
      pauseDuration: /* ms */ number,
      turnLimit: /* ms */ number,
      warningOffset: /* ms */ number,
      votePadding: /* ms */ number
    },
    public speakingTracker: SpeakingTracker,
    public deafenTracker: DeafenTracker,
    public extensionService: ExtensionService) {
    }

  private evaluateActiveUserWithExtension(userId: string, timeMS: number, event: TimeEvent) {
    const ext = this.extensionService.getExtension(userId)
    if(ext.count === 0) return null;
    const endOfTurn = event.start + this.opts.turnLimit + ext.duration
    const extendedActivity = timeMS - this.opts.turnLimit
    const timeLeft = ext.duration - extendedActivity
    let user = { userId, votableWarning: false, overLimit: false, time: timeMS, until: undefined, endOfTurn }

    if(timeLeft < 0) {
      user.overLimit = true
      user.until = endOfTurn
    } else if(timeLeft < this.opts.warningOffset) {
      user.votableWarning = true;
      user.until = endOfTurn - this.opts.votePadding
    }
    return user;
  }

  public evaluateActiveUsers(): ActiveTurnUser[] {
    const activity = this.getActiveUsers()
    let evaluated: Array<ActiveTurnUser> = []
    for (const [userId, event] of activity) {
      if(event.end) {
        continue;
      }
      const end = Date.now()
      const timeMS = end - event.start
      const endOfTurn = event.start + this.opts.turnLimit
      let user = { userId, votableWarning: false, overLimit: false, time: timeMS, until: undefined, endOfTurn }
      if (timeMS > this.opts.turnLimit) {
        const result = this.evaluateActiveUserWithExtension(userId, timeMS, event)
        if(result) {
          user = result
        } else {
          user.overLimit = true
          user.until = endOfTurn
        }
      } else if (timeMS > this.opts.turnLimit - this.opts.warningOffset) {
        user.votableWarning = true;
        user.until = endOfTurn - this.opts.votePadding
      }
      evaluated.push(user)
    }
    return evaluated;
  }

  getActiveUsers(): Map<string, TimeEvent> {
    const now = Date.now()
    let potentialActiveIds = new Map<string, TimeEvent>()
    for (const [userId, history] of this.speakingTracker.users) {
      const lastEvent = this.getLastSmoothSpeakingEvent(history.events)
      if(!lastEvent) {
        continue;
      }
      const isStillSpeaking = lastEvent.end === null
      const isRecentlyStopped = (now - lastEvent.end) <= this.opts.pauseDuration
      const isEventLongEnough = (now - lastEvent.start) >= this.opts.pauseDuration
      if (isEventLongEnough && (isStillSpeaking || isRecentlyStopped)) {
        potentialActiveIds.set(userId, lastEvent)
      }
    }
    return potentialActiveIds
  }

  private getLastSmoothSpeakingEvent(events: TimeEvent[]): TimeEvent | null {
    if (events.length === 0) return null;
    let last = { ...events[events.length - 1] };
    for (let i = events.length - 2; i >= 0; i--) {
      const prev = events[i];
      if (last.start - prev.end <= this.opts.pauseDuration) {
        last.start = prev.start;
      } else {
        break;
      }
    }
    return last;
  }

  public getSmoothSpeakingEvents(events: TimeEvent[]): TimeEvent[] {
    if (events.length === 0) return [];
    const result: TimeEvent[] = [];
    let current: TimeEvent = { ...events[0] };
    for (let i = 1; i < events.length; i++) {
      const next = events[i];
      if (next.start - current.end <= this.opts.pauseDuration) {
        current.end = Math.max(current.end, next.end);
      } else {
        result.push(current);
        current = { ...next };
      }
    }
    result.push(current);
    return result;
  }
}

