Voice Chat Moderation Ruleset

1. **Core Concepts**

Participant: anyone connected to the voice channel.

Active participant: someone who has spoken for ≥30s in the recent period.

Passive participant: listening for at least 30s but hasn’t spoken (or hasn’t met the 30s threshold). Becomes passive again if silent for a period.

Turn: personal speaking window.

Period: group speaking window, sliding window of N seconds.

2. **Speaking Limits**

Turn limit: 90s (per continuous speech).

Natural break: ≤4s silence does not reset the turn; >4s ends it.

Turn limit is doubled until a turn or period warning.

Limit warning is sent at 60s into the turn (30s before max).
Period warning is sent if they dominate 75% of period and are currently in an active turn.

3. **Extensions**

Default extend: When a reminder fires, the speaker automatically gets +60s unless objected.

Hard veto: If any participant reacts ⛔ the extension is denied.

Extension cap: unlimited or set by moderator team.

4. **Jail (Cooldowns)**

Trigger jail:

- Exceeding turn limit without extension.
- Exceeding period guardrail without extension.

Repeated cooldowns:

- First jail: 2 * turn_limit (e.g. 180s).
- Subsequent jail: exponentially larger = previous_jail * 2.
- Cap: 5 minutes (configurable).
- Easing: If user respects limits for one full period, jail multiplier resets.

Passive bonus applies: +1s per 4s spent passive, added only to the next turn's limit, capped at +90s. (one full turn limit extra - after around 5 minutes )

When passive bonus reaches cap they can be notified of this.

5. **Period**

Window calculation:

Formula = turn_limit * num_participants * breathing_factor. (factor ~1.2–1.5).

Keeps cumulative fair without penalizing silent listeners too much.

Start of period is start of conversation until the length of the conversation reaches length of the window. At that point start of the window starts sliding in the direction of the present at the same pace. 

If the window needs to be increased in length then window start becomes fixed until the present reaches appropriate distance.

If the window needs to be decreased, delay decreasing it for `turn limit * 2`.

6. **State Transitions**

Becomes active: after speaking ≥30s in one turn.

Becomes passive: if silent for one full cumulative window.

Entering jail: cannot speak until timer expires.

Leaving jail: can speak again, with multiplier possibly reset if good behavior sustained.

7. **Bot Messaging Rules**

Reminders:

At 60s: “You have 30s left. Anyone can ⛔ react to block extension.”

Extension granted: “+60s granted by default (no objections).” ( X more extensions available if limited )

Extension vetoed: “Extension vetoed. Please wrap up.”

Jail entry: “@User is muted for Xs (over limit).”

Jail decay reset: (optional) DM to user: “Good pacing — your jail timer is reset.”

Stats (private DM on request): turn time, total window time, current jail multiplier.

8. **Fairness Safeguards**

Transparency: Only violations and extensions are public. Stats are private.

No punishment for pauses: short breaks don’t game the system.

Democracy: Extension veto is equal rights (1 participant = 1 veto).

Fail-safes:

Veto credits based on time?

Jail has max cap.



