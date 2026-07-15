/** Match event domain: the atomic unit flowing through the whole pipeline. */

export const EVENT_TYPES = [
  'GOAL',
  'YELLOW_CARD',
  'RED_CARD',
  'SUBSTITUTION',
  'KICK_OFF',
  'FULL_TIME',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * A single match event, following the format suggested in the task brief.
 * One addition: `sequence` — a per-match monotonic counter assigned by the
 * provider. It is what lets the backend restore order when events arrive
 * out of sequence (minute alone is not unique: two events can share a minute).
 */
export interface MatchEvent {
  eventId: string;
  matchId: string;
  type: EventType;
  /** null for match-level events (KICK_OFF / FULL_TIME) */
  team: 'home' | 'away' | null;
  minute: number;
  /** null for events without a player (KICK_OFF / FULL_TIME) */
  player: string | null;
  sequence: number;
  /** simulated match-clock time of the event */
  timestamp: string;
}
