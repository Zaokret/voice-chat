import EventEmitter from "node:events";
import { TurnTracker } from "./wave-turn-tracker";
import { Period, VoiceControllerEvents } from "./types";

export class VoiceController {
    perSecond: NodeJS.Timeout = null;
    perPeriod: NodeJS.Timeout = null;
    events = new EventEmitter<VoiceControllerEvents>()
    periodLength: number;
    periods = new Array<Period>();
    constructor(public opts: {
        jailDuration: number, // ms same as once a turn duration
        activeUserWeight: number,   //0.8
        passiveUserWeight: number,  //0.2
        initialPeriodFactor: number, //2
        activeUserThreshold: number, //30_000
        periodBreathingFactor: number, // 1.1
        eligibleVoterTimeReq: number, // 30_000
        periodVoteRepeatFrequency: number, // period limit 90_000
        periodVoteDuration: number, // period limit - vote padding 75_000
    }, public turnTracker: TurnTracker) {
        const initialPeriodLength = this.turnTracker.opts.turnLimit * this.opts.initialPeriodFactor;
        this.periodLength = initialPeriodLength
    }

    public getPeriodActivityPercentage() {
        const activity = this.getPeriodActivity()
        let percentages = new Map<string, number>()
        for (const [id, time] of activity.users) {
            const perc = Math.floor(time * 100 / this.periodLength)
            percentages.set(id, perc)
        }
        return percentages
    }

    private getPeriodActivity() {
        const now = Date.now()
        const from = now - this.periodLength
        let users = new Map<string, number>()
        for (const [id] of this.turnTracker.speakingTracker.users) {
            const state = this.turnTracker.speakingTracker.vcTracker.getUserState(id)
            if (state && state.present) {
                const events = this.turnTracker.speakingTracker.getAbsoluteRange(id, from, now)
                const smoothed = this.turnTracker.getSmoothSpeakingEvents(events)
                const timeMS = this.turnTracker.speakingTracker.getSpeakingTimeFromEvents(smoothed)
                users.set(id, timeMS)
            }
        }

        return { start: from, end: now, users: users }
    }

    // only present are weighted
    // jailed are counted as active
    private getWeightedUserActivity(users: Period['users']) {
        let weight = 0
        for (const [_, time] of users) {
            if (time >= this.opts.activeUserThreshold) {
                weight += this.opts.activeUserWeight
            }
            else {
                weight += this.opts.passiveUserWeight
            }
        }
        return weight
    }

    private getNextPeriodLength({ turnLimit, weightedActivity, breathingFactor }: { turnLimit: number, weightedActivity: number, breathingFactor: number }) {
        const duration = turnLimit * Math.max(1, weightedActivity) * breathingFactor;
        return Math.max(this.turnTracker.opts.turnLimit * 2, duration)
    }

    immuneUsers = new Set<string>()

    public startPeriod() {
        // this.periods.push({ start: Date.now(), end: null })
        this.perPeriod = setTimeout(() => {
            const users = this.turnTracker.getActiveUsers()
            for (const userId of users.keys()) {
                this.immuneUsers.add(userId)
            }

            const period = this.getPeriodActivity()
            this.periods.push(period)
            const weightedActivity = this.getWeightedUserActivity(period.users)
            this.periodLength = this.getNextPeriodLength({
                    turnLimit: this.turnTracker.opts.turnLimit,
                    weightedActivity: weightedActivity,
                    breathingFactor: this.opts.periodBreathingFactor
                })
            clearTimeout(this.perPeriod)
            if (this.periodLength !== 0) {
                this.startPeriod()
            }
        }, this.periodLength)
    }

    public endPeriod() {
        clearInterval(this.perPeriod)
        this.perPeriod = null;
        this.periodLength = 0;
    }

    public startSeconds() {
        this.perSecond = setInterval(() => {
            const now = Date.now();
            const activeUsers = this.turnTracker.getActiveUsers()
            // function removePeriodImmuneUsers
            for (const immuneUserId of this.immuneUsers) {
                if (!activeUsers.has(immuneUserId)) {
                    this.immuneUsers.delete(immuneUserId)
                }
            }

            // function removeTurnExtensions
            for (const [id, extension] of this.turnTracker.extensionService.users) {
                if (extension.end > now && !activeUsers.has(id)) {
                    this.turnTracker.extensionService.removeExtension(id)
                }
            }

            this.turnPhase()
            if(this.periods.length > 0) {
                this.periodPhase()
            }
        }, 1000)
    }

    private periodPhase() {
        const activity = this.getPeriodActivityPercentage()
        for (const [id, perc] of activity) {
            if (perc > 75) {
                const voters = this.turnTracker.speakingTracker.vcTracker
                    .getEligibleVoters(this.opts.eligibleVoterTimeReq, this.turnTracker.deafenTracker)
                this.events.emit("PERIOD_LIMIT_REACHED", {
                    type: "PERIOD_LIMIT_REACHED",
                    userId: id,
                    message: `active for ${perc}% of ${this.periodLength}`,
                    voters
                })
            } else if (perc > 65) {
                this.events.emit("PERIOD_LIMIT_WARNING", {
                    type: "PERIOD_LIMIT_WARNING",
                    userId: id,
                    message: `active for ${perc}% of ${this.periodLength}`
                })
            }
        }
    }

    public endSeconds() {
        clearInterval(this.perSecond)
        this.perSecond = null;
    }

    private turnPhase() {
        const activity = this.turnTracker.evaluateActiveUsers()
        const voters = this.turnTracker.speakingTracker.vcTracker
            .getEligibleVoters(this.opts.eligibleVoterTimeReq, this.turnTracker.deafenTracker)
        for (const user of activity) {
            if (user.overLimit) {
                this.events.emit("TURN_LIMIT_REACHED", {
                    type: "TURN_LIMIT_REACHED",
                    userId: user.userId,
                    message: `active for ${user.time}`,
                    activeTime: user.time,
                    endOfTurn: user.endOfTurn,
                })
            } else if (user.votableWarning) {
                this.events.emit("TURN_LIMIT_WARNING_VOTE_OPENNED", {
                    type: "TURN_LIMIT_WARNING_VOTE_OPENNED",
                    userId: user.userId,
                    message: `active for ${user.time}`,
                    until: user.until,
                    endOfTurn: user.endOfTurn,
                    voters: voters
                })
            }
        }
    }
}


