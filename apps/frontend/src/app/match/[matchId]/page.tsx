'use client';

/**
 * Match screen: subscribes to one match over Socket.IO. On subscribe the
 * server sends a full `snapshot` (late joiners see the current score), then
 * incremental `match:events` batches. Genuinely new events after the snapshot
 * pop animated toast notifications; the score bumps on change.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { MatchEvent, MatchEventPush, MatchSnapshot, MatchStatus } from '@koora/shared';
import { StatusBadge } from '@/components/status-badge';
import { describeEvent, ICONS } from '@/lib/event-ui';
import { getSocket } from '@/lib/socket';

const MAX_TOASTS = 5;
const TOAST_DISMISS_MS = 4500;

interface Toast {
  id: number;
  kind: 'goal' | 'red' | 'yellow' | 'info';
  icon: string;
  title: string;
  body: string;
  leaving: boolean;
}

/** Inserts an event keeping newest-first (sequence desc) order; no duplicates. */
function insertDesc(events: MatchEvent[], event: MatchEvent): MatchEvent[] {
  let i = 0;
  while (i < events.length && events[i].sequence > event.sequence) i++;
  return [...events.slice(0, i), event, ...events.slice(i)];
}

export default function MatchPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = decodeURIComponent(params.matchId);

  const [teams, setTeams] = useState({ home: '', away: '' });
  const [score, setScore] = useState({ home: 0, away: 0 });
  const [status, setStatus] = useState<MatchStatus>('SCHEDULED');
  const [minute, setMinute] = useState(0);
  const [events, setEvents] = useState<MatchEvent[] | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bumpKey, setBumpKey] = useState(0);

  const eventIds = useRef(new Set<string>());
  const snapshotLoaded = useRef(false);
  const teamsRef = useRef(teams);
  const lastScore = useRef('');
  const nextToastId = useRef(1);
  const toastTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const socket = getSocket();

    // reset per-match state (the component instance survives route changes)
    eventIds.current.clear();
    snapshotLoaded.current = false;
    lastScore.current = '';
    setTeams({ home: '', away: '' });
    setScore({ home: 0, away: 0 });
    setStatus('SCHEDULED');
    setMinute(0);
    setEvents(null);
    setToasts([]);

    const applyScore = (s: { home: number; away: number }, st: MatchStatus, min: number) => {
      const text = `${s.home}-${s.away}`;
      if (lastScore.current && lastScore.current !== text) setBumpKey((k) => k + 1);
      lastScore.current = text;
      setScore(s);
      setStatus(st);
      setMinute(min);
    };

    const onSnapshot = (snap: MatchSnapshot) => {
      if (snap.matchId !== matchId) return;
      teamsRef.current = { home: snap.homeTeam, away: snap.awayTeam };
      setTeams(teamsRef.current);
      eventIds.current = new Set(snap.events.map((e) => e.eventId));
      let list: MatchEvent[] = [];
      for (const event of snap.events) list = insertDesc(list, event);
      setEvents(list);
      snapshotLoaded.current = true;
      applyScore(snap.score, snap.status, snap.minute);
    };

    // events arrive in batches: bursts are coalesced server-side
    const onEvents = (pushes: MatchEventPush[]) => {
      if (!Array.isArray(pushes)) return;
      const fresh: MatchEventPush[] = [];
      let latest: MatchEventPush | null = null;
      for (const push of pushes) {
        if (push.event.matchId !== matchId) continue;
        if (!eventIds.current.has(push.event.eventId)) {
          eventIds.current.add(push.event.eventId);
          fresh.push(push);
        }
        latest = push;
      }
      if (fresh.length > 0) {
        setEvents((prev) => {
          let next = prev ?? [];
          for (const push of fresh) next = insertDesc(next, push.event);
          return next;
        });
        // only pop notifications for genuinely new events after the snapshot
        if (snapshotLoaded.current) for (const push of fresh) pushToast(push);
      }
      if (latest) applyScore(latest.score, latest.status, latest.minute);
    };

    const subscribe = () => {
      setSocketConnected(true);
      socket.emit('subscribe', { matchId });
    };
    const onDisconnect = () => setSocketConnected(false);

    socket.on('snapshot', onSnapshot);
    socket.on('match:events', onEvents);
    socket.on('connect', subscribe);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) subscribe();

    const timers = toastTimers.current;
    return () => {
      socket.emit('unsubscribe', { matchId });
      socket.off('snapshot', onSnapshot);
      socket.off('match:events', onEvents);
      socket.off('connect', subscribe);
      socket.off('disconnect', onDisconnect);
      timers.forEach(clearTimeout);
      timers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    document.title =
      teams.home && teams.away
        ? `${teams.home} vs ${teams.away} — Koora Break`
        : 'Koora Break — Live Scores';
    return () => {
      document.title = 'Koora Break — Live Scores';
    };
  }, [teams]);

  // -------------------------------------------------------------------------
  // Toasts
  // -------------------------------------------------------------------------

  function pushToast(push: MatchEventPush) {
    const { event, score: s } = push;
    const { home, away } = teamsRef.current;
    const teamName = event.team === 'home' ? home : event.team === 'away' ? away : null;
    const scoreLine = `${home} ${s.home} – ${s.away} ${away}`;

    let kind: Toast['kind'] = 'info';
    let title: string;
    let body: string;
    switch (event.type) {
      case 'GOAL':
        kind = 'goal';
        title = `GOAL! ${teamName}`;
        body = `${event.minute}' ${event.player} · ${scoreLine}`;
        break;
      case 'YELLOW_CARD':
        kind = 'yellow';
        title = `Yellow card · ${teamName}`;
        body = `${event.minute}' ${event.player}`;
        break;
      case 'RED_CARD':
        kind = 'red';
        title = `RED CARD! ${teamName}`;
        body = `${event.minute}' ${event.player} is sent off`;
        break;
      case 'SUBSTITUTION':
        title = `Substitution · ${teamName}`;
        body = `${event.minute}' ${event.player} comes on`;
        break;
      case 'KICK_OFF':
        title = 'Kick-off!';
        body = `${home} vs ${away} is under way`;
        break;
      case 'FULL_TIME':
        title = 'Full time';
        body = scoreLine;
        break;
    }

    const id = nextToastId.current++;
    setToasts((prev) =>
      [{ id, kind, icon: ICONS[event.type], title, body, leaving: false }, ...prev].slice(
        0,
        MAX_TOASTS,
      ),
    );
    const timer = setTimeout(() => dismissToast(id), TOAST_DISMISS_MS);
    toastTimers.current.add(timer);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // -------------------------------------------------------------------------

  return (
    <section className="mx-auto max-w-[760px] p-5">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/"
          className="inline-block rounded-lg border border-edge px-3.5 py-2 text-[0.85rem] font-semibold whitespace-nowrap hover:border-muted"
        >
          ← All matches
        </Link>
        <span
          title="connection status"
          className={`h-2.5 w-2.5 rounded-full ${
            socketConnected ? 'bg-accent shadow-[0_0_6px_var(--color-accent)]' : 'bg-live'
          }`}
        />
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-[14px] border border-edge bg-card px-4 py-7">
        <div className="text-center text-[1.15rem] font-semibold">{teams.home}</div>
        <div className="text-center">
          <div
            key={bumpKey}
            className={`text-[2.4rem] font-bold tabular-nums ${bumpKey > 0 ? 'animate-bump' : ''}`}
          >
            {events === null ? '– : –' : `${score.home} – ${score.away}`}
          </div>
          <div className="mt-1">
            <StatusBadge status={status} minute={minute} />
          </div>
        </div>
        <div className="text-center text-[1.15rem] font-semibold">{teams.away}</div>
      </div>

      <h3 className="mt-5 mb-2.5 text-[0.85rem] tracking-[0.8px] text-muted uppercase">
        Match timeline
      </h3>
      {events === null ? (
        <p className="py-2.5 text-center text-[0.8rem] text-muted">loading match…</p>
      ) : events.length === 0 ? (
        <p className="py-2.5 text-center text-[0.8rem] text-muted">
          no events yet — waiting for kick-off
        </p>
      ) : (
        <div className="relative">
          {/* center spine: home events left of it, away events right of it */}
          <div aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-edge" />

          <div className="relative mb-2.5 grid grid-cols-2 gap-x-5 text-center text-[0.72rem] font-bold tracking-[0.5px] text-muted uppercase">
            <span className="truncate">{teams.home}</span>
            <span className="truncate">{teams.away}</span>
          </div>

          <ul className="flex flex-col gap-1.5">
            {events.map((event) => (
              <li
                key={event.eventId}
                className="relative grid animate-pop grid-cols-2 items-center gap-x-5"
              >
                {event.team !== null && (
                  <span
                    aria-hidden
                    className={`absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full ${
                      event.type === 'GOAL'
                        ? 'bg-accent'
                        : event.type === 'RED_CARD'
                          ? 'bg-live'
                          : event.type === 'YELLOW_CARD'
                            ? 'bg-gold'
                            : 'bg-[#3a4353]'
                    }`}
                  />
                )}
                {event.team === null ? (
                  <span className="z-10 col-span-2 justify-self-center rounded-full border border-edge bg-[#10151d] px-4 py-1.5 text-[0.8rem] text-muted">
                    {ICONS[event.type]} {describeEvent(event)} · {event.minute}&apos;
                  </span>
                ) : (
                  <div
                    className={`flex items-center gap-2 rounded-lg bg-[#10151d] px-3 py-2.5 text-[0.9rem] ${
                      event.team === 'home' ? 'col-start-1 flex-row-reverse' : 'col-start-2'
                    } ${
                      event.type === 'GOAL'
                        ? event.team === 'home'
                          ? 'border-r-[3px] border-r-accent'
                          : 'border-l-[3px] border-l-accent'
                        : ''
                    }`}
                  >
                    <span className="text-muted tabular-nums">{event.minute}&apos;</span>
                    <span>{ICONS[event.type]}</span>
                    <span className={`min-w-0 flex-1 ${event.team === 'home' ? 'text-right' : ''}`}>
                      {describeEvent(event)}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Animated event notifications */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed top-[18px] right-[18px] z-[100] flex w-[min(380px,calc(100vw-36px))] flex-col gap-2.5"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onClick={() => dismissToast(toast.id)}
            onAnimationEnd={toast.leaving ? () => removeToast(toast.id) : undefined}
            className={`pointer-events-auto flex cursor-pointer items-center gap-3 rounded-xl border border-edge bg-[#1b222d] px-[15px] py-[13px] shadow-[0_10px_28px_rgba(0,0,0,0.5)] ${
              toast.leaving ? 'animate-toast-out' : 'animate-toast-in'
            } ${
              toast.kind === 'goal'
                ? 'border-l-4 border-l-accent bg-[linear-gradient(90deg,rgba(46,204,113,0.14),#1b222d_55%)]'
                : toast.kind === 'red'
                  ? 'border-l-4 border-l-live bg-[linear-gradient(90deg,rgba(231,76,60,0.14),#1b222d_55%)]'
                  : toast.kind === 'yellow'
                    ? 'border-l-4 border-l-gold'
                    : 'border-l-4 border-l-muted'
            }`}
          >
            <span
              className={`text-2xl leading-none ${
                toast.kind === 'goal'
                  ? 'animate-ball-pop'
                  : toast.kind === 'red'
                    ? 'animate-card-flash-2'
                    : toast.kind === 'yellow'
                      ? 'animate-card-flash'
                      : ''
              }`}
            >
              {toast.icon}
            </span>
            <div className="min-w-0">
              <div
                className={`text-[0.9rem] font-bold ${
                  toast.kind === 'goal' ? 'text-accent' : toast.kind === 'red' ? 'text-live' : ''
                }`}
              >
                {toast.title}
              </div>
              <div className="mt-0.5 text-[0.8rem] text-muted">{toast.body}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
