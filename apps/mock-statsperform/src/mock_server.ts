/**
 * Mock StatsPerform server — single-file, no env config, 1 match minute = 1 second.
 * Plays ONE round: matches kick off when the server starts, play out, finish —
 * then the mock goes idle (restart it for a new round). Broadcasts every event
 * to every consumer; replays everything emitted so far on connect.
 */
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { Fixture, MatchEvent, ProviderMessage } from '@koora/shared';
import { PLAYERS, TEAMS } from './mock-data';

const PORT = 4001;
const MATCH_COUNT = 12;
const MINUTE_MS = 1000;   // 1 simulated minute = 1 real second (match lasts ~90s)
const OOO_RATE = 0.12;    // chance an event is delivered late (out of order)
const STAGGER_MS = 25_000; // max random kick-off offset
const TICK_MS = 10;

const RUN_ID = Math.random().toString(36).slice(2, 6);
const wss = new WebSocketServer({ port: PORT });
const log = (m: string) => console.log(`[mock] ${m}`);

const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[randInt(0, arr.length - 1)];
const shuffle = <T>(arr: readonly T[]): T[] => [...arr].sort(() => Math.random() - 0.5);

interface QueuedEvent { dueAt: number; event: MatchEvent; delayed: boolean }

let emitted: ProviderMessage[] = [];
let queue: QueuedEvent[] = [];
let idx = 0;

function broadcast(message: ProviderMessage) {
  const data = JSON.stringify(message);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
}

/** Scripted timeline + real send offsets for one match. */
function simulateMatch(matchId: string, homeTeam: string, awayTeam: string, kickoffDelayMs: number) {
  const kickoffMs = Date.now() + kickoffDelayMs;
  const fixture: Fixture = { matchId, homeTeam, awayTeam, kickoffAt: new Date(kickoffMs).toISOString() };

  const raw: Pick<MatchEvent, 'type' | 'team' | 'minute' | 'player'>[] = [
    { type: 'KICK_OFF', team: null, minute: 0, player: null },
    { type: 'FULL_TIME', team: null, minute: 90, player: null },
  ];
  for (const team of ['home', 'away'] as const) {
    for (let i = 0; i < pick([0, 0, 1, 1, 1, 2, 2, 3, 4]); i++)
      raw.push({ type: 'GOAL', team, minute: randInt(1, 90), player: pick(PLAYERS) });
    for (let i = 0; i < randInt(0, 3); i++)
      raw.push({ type: 'YELLOW_CARD', team, minute: randInt(5, 90), player: pick(PLAYERS) });
    if (Math.random() < 0.12)
      raw.push({ type: 'RED_CARD', team, minute: randInt(25, 90), player: pick(PLAYERS) });
    for (let i = 0; i < randInt(2, 3); i++)
      raw.push({ type: 'SUBSTITUTION', team, minute: randInt(46, 88), player: pick(PLAYERS) });
  }
  raw.sort((a, b) => a.minute - b.minute);

  const schedule: QueuedEvent[] = raw.map((e, sequence) => {
    const delayed = Math.random() < OOO_RATE;
    const dueMs =
      kickoffDelayMs +
      e.minute * MINUTE_MS +
      Math.random() * MINUTE_MS * 0.4 +          // jitter within the minute
      (delayed ? MINUTE_MS * (2 + Math.random() * 2) : 0); // held back 2-4 minutes
    return {
      dueAt: Date.now() + dueMs,
      delayed,
      event: {
        ...e,
        eventId: randomUUID(),
        matchId,
        sequence,
        timestamp: new Date(kickoffMs + e.minute * 60_000).toISOString(),
      },
    };
  });

  return { fixture, schedule };
}

function startMatches() {
  const teams = shuffle(TEAMS);
  const matches = Array.from({ length: MATCH_COUNT }, (_, i) =>
    simulateMatch(
      `match_${RUN_ID}_${String(i + 1).padStart(2, '0')}`,
      teams[i * 2],
      teams[i * 2 + 1],
      Math.random() * STAGGER_MS,
    ),
  );

  queue = matches.flatMap((m) => m.schedule).sort((a, b) => a.dueAt - b.dueAt);

  const fixturesMsg: ProviderMessage = { kind: 'fixtures', payload: matches.map((m) => m.fixture) };
  emitted.push(fixturesMsg);
  broadcast(fixturesMsg);
  log(`${MATCH_COUNT} matches scheduled`);
}

function tick() {
  const now = Date.now();
  while (idx < queue.length && queue[idx].dueAt <= now) {
    const { event, delayed } = queue[idx++];
    const message: ProviderMessage = { kind: 'event', payload: event, emittedAt: new Date().toISOString() };
    emitted.push(message);
    broadcast(message);
    log(`${event.matchId} seq=${event.sequence} ${event.minute}' ${event.type}${delayed ? ' (late)' : ''}`);
  }
  // queue.length check: the queue is only filled once the server is listening
  if (queue.length > 0 && idx >= queue.length) {
    clearInterval(ticker);
    log('all matches finished — mock is idle (restart it for a new round)');
  }
}

wss.on('connection', (socket) => {
  log(`consumer connected, replaying ${emitted.length} messages`);
  for (const m of emitted) socket.send(JSON.stringify(m));
});

const ticker = setInterval(tick, TICK_MS);
wss.on('listening', () => {
  log(`listening on ws://localhost:${PORT}`);
  startMatches();
});
process.on('SIGINT', () => {
  clearInterval(ticker);
  wss.close();
  process.exit(0);
});