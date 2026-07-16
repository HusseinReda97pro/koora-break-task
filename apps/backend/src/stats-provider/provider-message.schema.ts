import { z } from 'zod';
import { EVENT_TYPES, Fixture, MatchEvent, ProviderMessage } from '@koora/shared';

/**
 * Validation at the trust boundary. Everything arriving from the provider is
 * treated as untrusted input: unparseable JSON, unknown event types or missing
 * fields are counted and dropped instead of crashing the pipeline.
 */
export const matchEventSchema = z.object({
  eventId: z.string().min(1),
  matchId: z.string().min(1),
  type: z.enum(EVENT_TYPES),
  team: z.enum(['home', 'away']).nullable(),
  minute: z.number().int().min(0).max(150),
  player: z.string().nullable(),
  sequence: z.number().int().min(0),
  timestamp: z.string().min(1),
});

export const fixtureSchema = z.object({
  matchId: z.string().min(1),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  kickoffAt: z.string().min(1),
});

export const providerMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixtures'), payload: z.array(fixtureSchema) }),
  z.object({ kind: z.literal('event'), payload: matchEventSchema, emittedAt: z.string() }),
]);

export type ValidProviderMessage = z.infer<typeof providerMessageSchema>;

// ---------------------------------------------------------------------------
// Compile-time lock: these schemas are the backend's boundary validators (the
// class-validator-DTO equivalent in this codebase) and must stay mutually
// assignable with the shared contract types — if either side drifts, the
// build fails here. Type-level only; nothing below exists at runtime.
// ---------------------------------------------------------------------------
type MutuallyAssignable<A extends B, B extends C, C = A> = never;

type _matchEventLock = MutuallyAssignable<z.infer<typeof matchEventSchema>, MatchEvent>;
type _fixtureLock = MutuallyAssignable<z.infer<typeof fixtureSchema>, Fixture>;
type _providerMessageLock = MutuallyAssignable<ValidProviderMessage, ProviderMessage>;
