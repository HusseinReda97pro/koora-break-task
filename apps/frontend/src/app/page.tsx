'use client';

/**
 * Lobby: every match with live score and status, pushed over Socket.IO
 * (`lobby:update`, at most once per second). Rows flash when a score changes;
 * clicking a row opens the match screen.
 */
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { LobbyUpdate, MatchSummary, ProviderStatus } from '@koora/shared';
import { StatusBadge } from '@/components/status-badge';
import { visibleMatches } from '@/lib/lobby';
import { getSocket } from '@/lib/socket';

export default function LobbyPage() {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [provider, setProvider] = useState<ProviderStatus>({ connected: false });
  const [socketConnected, setSocketConnected] = useState(false);

  // score-change tracking for the row flash animation: a row is remounted
  // (key change) whenever its score changes, which restarts the animation
  const prevScores = useRef(new Map<string, string>());
  const flashKeys = useRef(new Map<string, number>());

  useEffect(() => {
    const socket = getSocket();

    const onUpdate = (payload: LobbyUpdate) => {
      const sorted = visibleMatches(payload.matches);

      const knownIds = new Set(sorted.map((m) => m.matchId));
      for (const staleId of [...prevScores.current.keys()]) {
        if (!knownIds.has(staleId)) {
          prevScores.current.delete(staleId);
          flashKeys.current.delete(staleId);
        }
      }
      for (const m of sorted) {
        const score = `${m.score.home}-${m.score.away}`;
        const prev = prevScores.current.get(m.matchId);
        if (prev !== undefined && prev !== score) {
          flashKeys.current.set(m.matchId, (flashKeys.current.get(m.matchId) ?? 0) + 1);
        }
        prevScores.current.set(m.matchId, score);
      }

      setMatches(sorted);
      setProvider(payload.provider);
    };

    const subscribe = () => {
      setSocketConnected(true);
      socket.emit('lobby:subscribe'); // server replies with current state
    };
    const onDisconnect = () => setSocketConnected(false);

    socket.on('lobby:update', onUpdate);
    socket.on('connect', subscribe);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) subscribe();

    return () => {
      socket.emit('lobby:unsubscribe');
      socket.off('lobby:update', onUpdate);
      socket.off('connect', subscribe);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const liveCount = matches?.filter((m) => m.status === 'LIVE').length ?? 0;

  return (
    <section className="mx-auto max-w-[760px] px-5 py-6">
      <div className="mb-3.5 flex items-center gap-3">
        <h2 className="text-[1.05rem] font-bold">Matches</h2>
        {liveCount > 0 && (
          <span className="animate-pulse-soft rounded-full bg-live/15 px-2.5 py-[3px] text-[0.7rem] font-bold tracking-[0.5px] text-live">
            {liveCount} LIVE
          </span>
        )}
        <ProviderPill provider={provider} socketConnected={socketConnected} />
      </div>

      <div className="flex flex-col gap-2">
        {matches === null ? (
          <p className="py-2.5 text-center text-[0.8rem] text-muted">loading matches…</p>
        ) : matches.length === 0 ? (
          <p className="py-2.5 text-center text-[0.8rem] text-muted">
            no matches yet — waiting for fixtures
          </p>
        ) : (
          matches.map((m) => {
            const flashKey = flashKeys.current.get(m.matchId) ?? 0;
            return (
              <Link
                key={`${m.matchId}:${flashKey}`}
                href={`/match/${encodeURIComponent(m.matchId)}`}
                className={`grid w-full grid-cols-[1fr_auto_1fr_92px] items-center gap-3 rounded-[10px] border border-edge bg-card px-4 py-3.5 text-left transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-accent ${
                  flashKey > 0 ? 'animate-row-flash' : ''
                }`}
              >
                <span className="text-right text-[0.92rem] font-semibold">{m.homeTeam}</span>
                <span className="min-w-[58px] text-center text-[1.05rem] font-bold tabular-nums whitespace-nowrap">
                  {m.score.home} – {m.score.away}
                </span>
                <span className="text-left text-[0.92rem] font-semibold">{m.awayTeam}</span>
                <span className="justify-self-end">
                  <StatusBadge status={m.status} minute={m.minute} />
                </span>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}

/** Shows whether the backend holds a live feed connection to the provider. */
function ProviderPill({
  provider,
  socketConnected,
}: {
  provider: ProviderStatus;
  socketConnected: boolean;
}) {
  const online = socketConnected && provider.connected;
  const label = !socketConnected
    ? 'connection lost — reconnecting…'
    : provider.connected
      ? 'provider streaming'
      : 'provider offline';
  return (
    <span
      title="mock StatsPerform feed status"
      className={`ml-auto inline-flex items-center gap-[7px] rounded-full border border-edge bg-card px-3 py-[7px] text-[0.78rem] font-semibold whitespace-nowrap ${
        online ? 'text-accent' : 'text-muted'
      }`}
    >
      <span
        className={`h-[9px] w-[9px] rounded-full ${
          online ? 'animate-pulse-soft bg-accent shadow-[0_0_6px_var(--color-accent)]' : 'bg-[#555]'
        }`}
      />
      {label}
    </span>
  );
}
