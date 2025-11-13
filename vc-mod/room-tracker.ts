import EventEmitter from "node:events";
import { VoiceChatRoomUserState } from "./types";
import { GuildMember } from "discord.js";
import { canListen, canSpeak } from "./voice-state-mapper";
import { DeafenTracker } from "./speaking-tracker";

export class VoiceChatRoomTracker {
    users: Map<string, VoiceChatRoomUserState> = new Map()
  constructor(...users: GuildMember[]) {
    this.addUsers(...users)
  }

  getPresentUsers(): Array<{userId: string} & VoiceChatRoomUserState> {
    const arr = []
    for (const [id, state] of this.users) {
      if(state.present) {
        arr.push({userId: id, ...state})
      }
    }
    return arr;
  }

  addUsers(...users: GuildMember[]) {
    for (const user of users) {
      console.log('added ', user.id)
      this.users.set(user.id, {
        channelId: user.voice.channelId,
        lastJoinedAt: Date.now(),
        lastLeftAt: null,
        present: true,
        listen: canListen(user.voice),
        speak: canSpeak(user.voice)
      })
    }
  }

  attach(eventStream: EventEmitter) {
    eventStream.on('join', ({ user }) => {
        console.log(`${user.tag} joined VC`);
        this.users.set(user.id, {
          channelId: user.channelId,
          lastJoinedAt: Date.now(),
          lastLeftAt: null,
          present: true,
          speak: false,
          listen: false
        });
    });

    eventStream.on('leave', ({ user }) => {
      const state = this.users.get(user.id)
      if(!state) return;
      this.users.set(user.id, {
         ...state,
         present: false,
         lastLeftAt: Date.now()
        });
      console.log(`${user.tag} left VC`);
    });

    eventStream.on('speakable', ({ user }) => {
      const state = this.users.get(user.id)
      if(!state) return;
      this.users.set(user.id, {
         ...state,
         speak: true,
        });
      console.log(`${user.tag} can speak`);
    });

    eventStream.on('unspeakable', ({ user }) => {
      const state = this.users.get(user.id)
      if(!state) return;
      this.users.set(user.id, {
         ...state,
         speak: false,
        });
      console.log(`${user.tag} can't speak`);
    });

    eventStream.on('listenable', ({ user }) => {
      const state = this.users.get(user.id)
      if(!state) return;
      this.users.set(user.id, {
         ...state,
         listen: true,
        });
      console.log(`${user.tag} can listen`);
    });

    eventStream.on('unlistenable', ({ user }) => {
      const state = this.users.get(user.id)
      if(!state) return;
      this.users.set(user.id, {
         ...state,
         listen: false,
        });
      console.log(`${user.tag} can't listen`);
    });

    // perUserEvents.forEach(eventName => {
    //   eventStream.on(eventName, ({ user }) => {
    //     const state = this.users.get(user.id)
    //     if (!state) return;
    //     this.users.set(user.id, { ...newState });
    //     console.log(`${user.tag} event: ${eventName}`);
    //   });
    // });
  }

  getUserState(userId: string) {
    return this.users.get(userId);
  }

  getAllUsers() {
    return Array.from(this.users.entries());
  }

  getEligibleVoters(timePresentReq: number, deafenTracker: DeafenTracker) {
    const now = Date.now()
    let voters = new Set<string>();
    for (const [id, state] of this.users) {

      const timeSinceJoined = now - state.lastJoinedAt;
      // TODO: track listening events to be able to determine amount of time listening
      if(state.present && state.listen && timeSinceJoined > timePresentReq) {
        const listeningTime = deafenTracker.getListeningTime(id)
        if(listeningTime > timePresentReq) {
          voters.add(id)
        }
      }
    }
    return Array.from(voters)
  }
}
