import { SlashCommandOptionsOnlyBuilder } from 'discord.js';
import { z, ZodNumber } from 'zod';
import { Guild } from '../repository';

export type UserHistory = {
    events: TimeEvent[];
};

export type TimeEvent = {
    start: number;
    end: number | null; // null if still speaking
};

export type ActiveTurnUser = { userId: string, votableWarning: boolean, overLimit: boolean, time: number, endOfTurn: number, until: number }

export type VoiceChatRoomUserState = {
    channelId: string;
    lastJoinedAt: number;
    lastLeftAt: number | null;
    present: boolean;
    speak: boolean;
    listen: boolean;
}

export type Period = { start: number, end: number, users: Map<string, number> };

export type VoiceControllerEvents = {
    "PERIOD_LIMIT_REACHED": [{ type: "PERIOD_LIMIT_REACHED", userId: string, message: string, voters: string[] }],
    "PERIOD_LIMIT_WARNING": [{ type: "PERIOD_LIMIT_WARNING", userId: string, message: string }],
    "TURN_LIMIT_REACHED": [{ type: "TURN_LIMIT_REACHED", userId: string, message: string, activeTime: number, endOfTurn: number }],
    "TURN_LIMIT_WARNING_VOTE_OPENNED": [{ type: "TURN_LIMIT_WARNING_VOTE_OPENNED", userId: string, message: string, until: number, voters: string[], endOfTurn: number }],
}

type Brand<K, T> = K & { __brand: T };
export type Second = Brand<number, "SECOND">;
export type Millisecond = Brand<number, "MILLISECOND">;

export class Time {
    static createSec(second: number): Second {
        return second as Second;
    }

    static createMS(Millisecond: number): Millisecond {
        return Millisecond as Millisecond;
    }

    static toSec(Millisecond: Millisecond, round: 'floor' | 'ceil' = 'floor'): Second {
        return Math[round](Millisecond / 1000) as Second
    }

    static toMS(second: Second): Millisecond {
        return second * 1000 as Millisecond
    }

    static addSec(...args: Second[]): Second {
        let total = 0
        for (const el of args) {
            total += el
        }
        return total as Second;
    }

    static addMS(...args: Millisecond[]): Millisecond {
        let total = 0
        for (const el of args) {
            total += el
        }
        return total as Millisecond;
    }

    static diffSec(a: Second, b: Second): Second {
        return a - b as Second;
    }

    static diffMS(a: Millisecond, b: Millisecond): Millisecond {
        return a - b as Millisecond;
    }
}


const Second = z.number().brand<'Second'>()
const Millisecond = z.number().brand<'Millisecond'>()

const Turn = Second.min(15).max(300);
const TurnOptions = z.object({
    turn: Turn.describe('Duration of a turn.'),
    extension: Turn.describe('Duration of the turn extension.'),
    vote: Second.min(15).describe('Duration of the vote.'),
    result: Second.min(15).describe('Duration of the vote result notification.'),
    pause: Second.min(1).max(10).describe('Duration of a pause that ends the turn automatically.'),
})
    .transform((data) => {
        const vote = data.vote + data.result;
        const turn = data.turn + data.vote + data.result;
        const extension = data.extension + data.vote + data.result;
        const transformed = {
            pause: data.pause,
            result: data.result,
            vote: vote,
            turn: turn,
            extension: extension
        }
        return transformed
    });

export function parseWaveConfig(entity: Guild) {
    const mode = 'wave';
    const vote = entity[`${mode}_vote`] + entity[`${mode}_result`];
    const turn = entity[`${mode}_turn`] + entity[`${mode}_vote`] + entity[`${mode}_result`];
    const extension = entity[`${mode}_extension`] + entity[`${mode}_vote`] + entity[`${mode}_result`];
    const transformed = {
        pause: entity[`${mode}_pause`],
        result: entity[`${mode}_result`],
        jail: entity[`${mode}_jail`],
        vote: vote,
        turn: turn,
        extension: extension
    }

    return {
            turnLimit: transformed.turn * 1000,
            pauseDuration: transformed.pause * 1000,
            warningOffset: transformed.vote * 1000,
            votePadding: transformed.result * 1000,
            extensionDuration: transformed.extension * 1000,
            jailDuration: transformed.jail * 1000
        }
}
export function parseQueueConfig(entity: Guild) {
    const mode = 'queue';
    const vote = entity[`${mode}_vote`] + entity[`${mode}_result`];
    const turn = entity[`${mode}_turn`] + entity[`${mode}_vote`] + entity[`${mode}_result`];
    const extension = entity[`${mode}_extension`] + entity[`${mode}_vote`] + entity[`${mode}_result`];
    const transformed = {
        pause: entity[`${mode}_pause`],
        result: entity[`${mode}_result`],
        jail: entity[`${mode}_jail`],
        vote: vote,
        turn: turn,
        extension: extension
    }
    return {
            turnLimit: transformed.turn,
            autoNextThreshold: transformed.pause,
            warningOffset: transformed.vote,
            votePadding: transformed.result,
            turnExtension: transformed.extension,
        }
}

function addNumberOptionsFromZodSchema(builder: SlashCommandOptionsOnlyBuilder, schema: any) {
    for (const [key, field] of Object.entries(schema.shape)) {
        if (field instanceof ZodNumber) {
            builder.addNumberOption((opt) => {
                opt.setName(key)
                    .setDescription(field.description || key)
                    .setRequired(false)

                const checks = field.def.checks as any;
                console.log(checks)
                for (const check of checks) {
                    if (check.kind === 'min') opt.setMinValue(check.value);
                    if (check.kind === 'max') opt.setMaxValue(check.value);
                }
                return opt;
            });
        }
    }
    return builder;
}
