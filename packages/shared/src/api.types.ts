/** API domain: the backend -> client contract (Socket.IO + REST). */

import { MatchEvent } from './event.types';
import { MatchStatus, MatchSummary } from './match.types';

/**
 * Incremental update pushed to subscribers of a match. Carries the event plus
 * the authoritative derived state, so a client never has to compute the score
 * itself — even if events reach it out of order, the score line stays correct.
 *
 * Delivered over the `match:events` message as a batch (MatchEventPush[]):
 * the first event for a quiet match goes out immediately; events arriving
 * within the coalescing window afterwards are batched into one message.
 */
export interface MatchEventPush {
  event: MatchEvent;
  score: { home: number; away: number };
  status: MatchStatus;
  minute: number;
  /** original provider emit time, for latency measurement */
  emittedAt: string;
}

/** Provider health as reported inside LobbyUpdate. */
export interface ProviderStatus {
  /** backend currently holds a live feed connection to the provider */
  connected: boolean;
}
/**
 * Pushed to members of the lobby room (`lobby:update`) at most once per
 * second, and only when the match list or provider status changed.
 */
export interface LobbyUpdate {
  matches: MatchSummary[];
  provider: ProviderStatus;
}
