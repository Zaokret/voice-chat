import { VoiceState } from "discord.js";
import { EventEmitter } from "node:events";

export function canSpeak(state: VoiceState): boolean {
    return state && !state.selfMute && !state.mute;
}
export function canListen(state: VoiceState): boolean {
    return state && !state.selfDeaf && !state.deaf;
}

export const mapVoiceStateUpdateToEvents = (eventStream: EventEmitter, targetVoiceChatId: string, oldState: VoiceState, newState: VoiceState) => {
    const member = newState.member ?? oldState.member
    const user = member.user;
    if(user.bot) {
        return;
    }
    const payload = { member, user, oldState, newState, timestamp: Date.now(), channelId: targetVoiceChatId }
    const wasSpeakable = canSpeak(oldState);
    const isSpeakable = canSpeak(newState);
    const wasListenable = canListen(oldState);
    const isListenable = canListen(newState);
    // console.log({old: oldState.channelId, new: newState.channelId, target: targetVoiceChatId})
    // console.log({wasSpeakable, isSpeakable, wasListenable, isListenable})
    if (oldState.channelId !== targetVoiceChatId && newState.channelId === targetVoiceChatId) {
        eventStream.emit('join', payload)
        eventStream.emit(isSpeakable ? 'speakable' : 'unspeakable', payload)
        eventStream.emit(isListenable ? 'listenable' : 'unlistenable', payload)
        return;
    }

    if (oldState.channelId === targetVoiceChatId && newState.channelId !== targetVoiceChatId) {
        eventStream.emit('leave', payload)
        eventStream.emit('unspeakable', payload)
        eventStream.emit('unlistenable', payload)
        return;
    }
    if (wasSpeakable && !isSpeakable) {
        eventStream.emit('unspeakable', payload);
    } else if (!wasSpeakable && isSpeakable) {
        eventStream.emit('speakable', payload);
    }

    if (wasListenable && !isListenable) {
        eventStream.emit('unlistenable', payload);
    } else if (!wasListenable && isListenable) {
        eventStream.emit('listenable', payload);
    }
}


