import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import {
  Fixture,
  MatchEvent,
  MatchSnapshot,
  MatchStatus,
  MatchSummary,
} from '@koora/shared';

/**
 * Pushed to the gateway whenever a match changes. Carries only the event and
 * the derived summary — full snapshots are built (and memoized) on demand for
 * subscribers, not copied on every event.
 */
export interface MatchUpdate {
  matchId: string;
  event: MatchEvent;
  score: { home: number; away: number };
  status: MatchStatus;
  minute: number;
  emittedAt: string;
}

interface MatchRecord {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  status: MatchStatus;
  score: { home: number; away: number };
  minute: number;
  /** ordered event log, sorted by sequence */
  events: MatchEvent[];
  seenEventIds: Set<string>;
  updatedAt: number;
  /** memoized snapshot, invalidated on every accepted event */
  cachedSnapshot?: MatchSnapshot;
}

/** Finished matches are kept around for a while, then garbage-collected. */
const RETENTION_MS = 10 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 1000;

/**
 * In-memory source of truth for live match state.
 *
 * Design choice: state is *derived by folding the ordered event log*, not
 * patched incrementally. Every accepted event is inserted into its sorted
 * position (by provider `sequence`) and score/status/minute are recomputed
 * from the log. A match produces a few dozen events, so the fold is trivially
 * cheap — and it makes out-of-order and duplicate delivery non-problems:
 * whatever order events arrive in, the fold always sees them in true order.
 */
@Injectable()
export class MatchStateService implements OnModuleDestroy {
  private readonly logger = new Logger(MatchStateService.name);
  private readonly matches = new Map<string, MatchRecord>();
  private readonly pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);

  /** Stream of accepted updates; the gateway subscribes and fans out. */
  readonly updates$ = new Subject<MatchUpdate>();

  /** Fires whenever the match list (fixtures, scores, statuses) changes. */
  readonly listChanged$ = new Subject<void>();

  registerFixtures(fixtures: Fixture[]): void {
    let added = 0;
    for (const fixture of fixtures) {
      if (this.matches.has(fixture.matchId)) continue;
      this.matches.set(fixture.matchId, {
        matchId: fixture.matchId,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        status: 'SCHEDULED',
        score: { home: 0, away: 0 },
        minute: 0,
        events: [],
        seenEventIds: new Set(),
        updatedAt: Date.now(),
      });
      added += 1;
    }
    if (added > 0) this.listChanged$.next();
    this.logger.log(`registered ${fixtures.length} fixtures (${this.matches.size} matches tracked)`);
  }

  /**
   * Applies one event. Returns 'applied' | 'duplicate'. Events for unknown
   * matches create a placeholder record (fixtures message may have been lost)
   * so no data is dropped on the floor.
   */
  applyEvent(event: MatchEvent, emittedAt: string): 'applied' | 'duplicate' {
    const record = this.getOrCreateRecord(event.matchId);

    if (record.seenEventIds.has(event.eventId)) {
      return 'duplicate';
    }
    record.seenEventIds.add(event.eventId);

    // insert into sorted position by provider sequence
    let i = record.events.length;
    while (i > 0 && record.events[i - 1].sequence > event.sequence) i--;
    record.events.splice(i, 0, event);

    this.recompute(record);
    record.updatedAt = Date.now();
    record.cachedSnapshot = undefined;

    this.updates$.next({
      matchId: record.matchId,
      event,
      score: { ...record.score },
      status: record.status,
      minute: record.minute,
      emittedAt,
    });
    this.listChanged$.next();
    return 'applied';
  }

  getSnapshot(matchId: string): MatchSnapshot | undefined {
    const record = this.matches.get(matchId);
    if (!record) return undefined;
    // memoized so a reconnect storm of subscribes doesn't copy the timeline
    // once per client — only once per state change
    record.cachedSnapshot ??= this.toSnapshot(record);
    return record.cachedSnapshot;
  }

  listMatches(): MatchSummary[] {
    return [...this.matches.values()].map((r) => ({
      matchId: r.matchId,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      status: r.status,
      score: { ...r.score },
      minute: r.minute,
    }));
  }

  onModuleDestroy(): void {
    clearInterval(this.pruneTimer);
    this.updates$.complete();
    this.listChanged$.complete();
  }

  private getOrCreateRecord(matchId: string): MatchRecord {
    let record = this.matches.get(matchId);
    if (!record) {
      record = {
        matchId,
        homeTeam: 'Unknown (home)',
        awayTeam: 'Unknown (away)',
        status: 'SCHEDULED',
        score: { home: 0, away: 0 },
        minute: 0,
        events: [],
        seenEventIds: new Set(),
        updatedAt: Date.now(),
      };
      this.matches.set(matchId, record);
      this.logger.warn(`event for unknown match ${matchId} - created placeholder record`);
    }
    return record;
  }

  /** Folds the ordered log into derived state. */
  private recompute(record: MatchRecord): void {
    const score = { home: 0, away: 0 };
    let status: MatchStatus = 'SCHEDULED';
    let minute = 0;

    for (const event of record.events) {
      minute = Math.max(minute, event.minute);
      switch (event.type) {
        case 'GOAL':
          if (event.team) score[event.team] += 1;
          break;
        case 'KICK_OFF':
          if (status === 'SCHEDULED') status = 'LIVE';
          break;
        case 'FULL_TIME':
          status = 'FINISHED';
          break;
      }
    }

    record.score = score;
    record.status = status;
    record.minute = minute;
  }

  private toSnapshot(record: MatchRecord): MatchSnapshot {
    return {
      matchId: record.matchId,
      homeTeam: record.homeTeam,
      awayTeam: record.awayTeam,
      status: record.status,
      score: { ...record.score },
      minute: record.minute,
      events: [...record.events],
      updatedAt: new Date(record.updatedAt).toISOString(),
    };
  }

  private prune(): void {
    // Only FINISHED matches are eligible: a SCHEDULED or LIVE match can sit
    // untouched for a while (e.g. during a provider outage) and must not be
    // forgotten — pruning it would resurrect it as an "Unknown" placeholder
    // when its events resume.
    const cutoff = Date.now() - RETENTION_MS;
    let pruned = 0;
    for (const [matchId, record] of this.matches) {
      if (record.status === 'FINISHED' && record.updatedAt < cutoff) {
        this.matches.delete(matchId);
        pruned += 1;
        this.logger.log(`pruned finished match ${matchId}`);
      }
    }
    if (pruned > 0) this.listChanged$.next();
  }
}
