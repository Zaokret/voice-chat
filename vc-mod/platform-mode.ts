import { GuildMember, GuildMemberEditOptions, TextChannel, VoiceChannel } from "discord.js";
import { VoiceChatRoomTracker } from "./room-tracker";
import { getMember } from "../utils";

export class PlatformController {
    constructor(
        public channel: TextChannel | VoiceChannel,
        public vcTracker: VoiceChatRoomTracker,
        public platformUserId: string) {

        }

    private setMute(member: GuildMember, state: boolean, reason?: string) {
        if(member.voice?.channel) {
            if(member.voice.serverMute === state) {
                console.log('already in the correct mute state')
                return member;
            }

            const nextState: GuildMemberEditOptions = { mute:state };
            if(reason) {
                nextState.reason = reason;
            }
            return member.edit(nextState)
        }
    }

    public async join(userId: string) {
        if(this.platformUserId !== userId) {
            const member = await this.getGuildMember(userId)
            return this.setMute(member, true, "auto-mod mode: platform")
        }
    }

    public async leave(userId: string) {
        const member = await this.getGuildMember(userId)
        return this.setMute(member, false, "auto-mod mode: platform")
    }

    private async getGuildMember(userId: string) {
        const channelMember= this.channel.members.get(userId);
        if(channelMember) return Promise.resolve(channelMember)
        return getMember(this.channel.guildId, userId)
      }

    public async start() {
        console.log('start-platform mute')
        return Promise.all(this.vcTracker.getPresentUsers().map(({userId}) => {
            return this.join(userId)
        }))
    }

    public async end() {
        console.log('end-platform unmute')
        return Promise.all(this.vcTracker.getPresentUsers().map(({userId}) => {
                return this.leave(userId)
        }))
    }
}