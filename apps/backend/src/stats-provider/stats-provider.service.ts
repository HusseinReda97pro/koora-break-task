import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import WebSocket from 'ws';
import { ProviderStatus } from '@koora/shared';
import { MatchStateService } from '../matches/match-state.service';
import { providerMessageSchema } from './provider-message.schema';

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;
const STATS_LOG_INTERVAL_MS = 15_000;
const HEARTBEAT_MS = 30_000;

/**
 * Consumes the StatsPerform firehose.
 *
 * Resilience posture:
 *  - the provider connection is assumed to drop: reconnect with exponential
 *    backoff, and rely on provider replay + eventId dedupe to converge again;
 *  - a connection can also die *silently* (peer killed without FIN/RST): a
 *    ping/pong heartbeat terminates any socket that stops answering, which
 *    feeds back into the reconnect path instead of wedging on a dead socket;
 *  - every inbound frame is untrusted: parse + schema-validate, count and drop
 *    anything malformed rather than letting one bad frame kill the pipeline.
 */
@Injectable()
export class StatsProviderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatsProviderService.name);
  private readonly url = process.env.MOCK_URL ?? 'ws://localhost:4001';

  private ws?: WebSocket;
  private backoffMs = INITIAL_BACKOFF_MS;
  private shuttingDown = false;
  private reconnectTimer?: NodeJS.Timeout;
  private statsTimer?: NodeJS.Timeout;

  /** Fires when the provider connection opens or closes. */
  readonly connectionChanged$ = new Subject<void>();

  private readonly stats = { received: 0, applied: 0, duplicates: 0, invalid: 0 };

  constructor(private readonly matchState: MatchStateService) {}

  onModuleInit(): void {
    this.connect();
    this.statsTimer = setInterval(() => {
      const { received, applied, duplicates, invalid } = this.stats;
      this.logger.log(`ingest stats: received=${received} applied=${applied} duplicates=${duplicates} invalid=${invalid}`);
    }, STATS_LOG_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.ws?.close();
    this.connectionChanged$.complete();
  }

  /** Current view of the provider, for the lobby status pill. */
  getProviderStatus(): ProviderStatus {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
    };
  }

  private connect(): void {
    this.logger.log(`connecting to provider at ${this.url}`);
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.logger.log('provider connection established');
      this.connectionChanged$.next();
    });

    this.ws.on('message', (data) => this.handleFrame(data.toString()));

    this.startHeartbeat(this.ws);

    this.ws.on('error', (err) => {
      const reason = err.message || (err as NodeJS.ErrnoException).code || err.constructor.name;
      this.logger.warn(`provider socket error: ${reason}`);
    });

    this.ws.on('close', () => {
      if (this.shuttingDown) return;
      this.connectionChanged$.next();
      this.logger.warn(`provider connection lost, retrying in ${this.backoffMs}ms`);
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    });
  }

  /**
   * Detects silently dead sockets: ping every HEARTBEAT_MS; if the previous
   * ping was never answered, terminate — the 'close' handler then reconnects.
   */
  private startHeartbeat(ws: WebSocket): void {
    let alive = true;
    ws.on('pong', () => (alive = true));
    const timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(timer);
        return;
      }
      if (!alive) {
        this.logger.warn('provider heartbeat missed, terminating stale socket');
        clearInterval(timer);
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);
    ws.on('close', () => clearInterval(timer));
  }

  private handleFrame(raw: string): void {
    this.stats.received += 1;

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.stats.invalid += 1;
      this.logger.warn(`dropped unparseable frame: ${raw.slice(0, 120)}`);
      return;
    }

    const parsed = providerMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.stats.invalid += 1;
      this.logger.warn(`dropped invalid message: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
      return;
    }

    const message = parsed.data;
    if (message.kind === 'fixtures') {
      this.matchState.registerFixtures(message.payload);
      return;
    }

    const outcome = this.matchState.applyEvent(message.payload, message.emittedAt);
    if (outcome === 'duplicate') {
      this.stats.duplicates += 1;
    } else {
      this.stats.applied += 1;
    }
  }
}
