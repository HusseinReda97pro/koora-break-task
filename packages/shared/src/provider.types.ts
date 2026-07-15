/** Provider domain: the StatsPerform (mock) WebSocket wire contract. */

import { MatchEvent } from './event.types';
import { Fixture } from './match.types';

/**
 * Envelope for everything the provider sends over its WebSocket.
 * `emittedAt` is the real wall-clock send time — the client simulator uses it
 * to measure end-to-end latency through the pipeline.
 * `status` reports whether the provider's stream is running or paused.
 */
export type ProviderMessage =
  | { kind: 'fixtures'; payload: Fixture[] }
  | { kind: 'event'; payload: MatchEvent; emittedAt: string }
  | { kind: 'status'; payload: { running: boolean } };

/** Consumer -> provider control channel (the mock honours pause/resume). */
export type ProviderControlMessage = { kind: 'control'; action: 'pause' | 'resume' };
