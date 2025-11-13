
export type UserExtension = {
  start?: number | undefined,
  end?: number | undefined,
  count: number
}

export class ExtensionService {
  users = new Map<string, UserExtension>()
  constructor(users: string[], public opts: { extensionDuration: number /* ms */ }) {
    for (const id of users) {
      this.users.set(id, { count: 0 });
    }
  }

  removeExtension(userId: string) {
    const state = this.users.get(userId)
    if(state) {
      this.users.set(userId, {
        count: 0,
        start: undefined,
        end: undefined
      })
    }
  }

  addExtension(userId: string, from?: number) {
    const state = this.users.get(userId)
    const now = Date.now()
    if(state && state.end && state.end >= now) {
      this.users.set(userId, {
        ...state,
        count: state.count + 1,
        end: state.end + this.opts.extensionDuration
      })
    } else {
      this.users.set(userId, {
        count: 1,
        start: from,
        end: from + this.opts.extensionDuration
      })
    }
  }

  getExtension(userId: string): UserExtension & { duration: number } {
    const ext = this.users.get(userId)
    return {
      ...ext, duration: ext.count * this.opts.extensionDuration
    }
  }
}