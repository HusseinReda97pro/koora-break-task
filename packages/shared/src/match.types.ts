/** Match domain: fixtures and the derived state of a match. */

import { MatchEvent } from './event.types';

export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED';

export interface Fixture {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
}

/** Full state of one match, sent to a client when it subscribes (late joiner). */
export interface MatchSnapshot {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  status: MatchStatus;
  score: { home: number; away: number };
  /** latest known match minute */
  minute: number;
  /** full timeline so far, sorted by sequence */
  events: MatchEvent[];
  updatedAt: string;
}

/** Lightweight listing used by the lobby / match picker. */
export interface MatchSummary {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  status: MatchStatus;
  score: { home: number; away: number };
  minute: number;
}
