import type { MatchStatus, MatchSummary } from '@koora/shared';

export const STATUS_ORDER: Record<MatchStatus, number> = { LIVE: 0, SCHEDULED: 1, FINISHED: 2 };

/**
 * The provider runs fixtures in cycles and the backend retains finished
 * matches for a while, so the raw lobby list piles up several past matches of
 * the same teams. Show each team at most once: rank matches by relevance
 * (LIVE > SCHEDULED > FINISHED, then newest first) and greedily keep a match
 * only if neither of its teams is already shown. Old cycles drop off as soon
 * as their teams reappear in new fixtures.
 */
export function visibleMatches(list: MatchSummary[]): MatchSummary[] {
  const ranked = [...list].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.matchId.localeCompare(a.matchId, undefined, { numeric: true }),
  );
  const claimedTeams = new Set<string>();
  const kept: MatchSummary[] = [];
  for (const m of ranked) {
    if (claimedTeams.has(m.homeTeam) || claimedTeams.has(m.awayTeam)) continue;
    claimedTeams.add(m.homeTeam);
    claimedTeams.add(m.awayTeam);
    kept.push(m);
  }
  // display order: LIVE first, then stable by id
  return kept.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.matchId.localeCompare(b.matchId),
  );
}
