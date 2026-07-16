import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { z } from 'zod';
import { LobbyUpdate, MatchEventPush } from '@koora/shared';
import { StatsProviderService } from '../stats-provider/stats-provider.service';
import { MatchStateService, MatchUpdate } from '../matches/match-state.service';

const subscribePayloadSchema = z.object({ matchId: z.string().min(1) });

const roomFor = (matchId: string) => `match:${matchId}`;
const LOBBY_ROOM = 'lobby';

/** lobby summaries are pushed at most once per second, and only when dirty */
const LOBBY_BROADCAST_MS = 1000;

/**
 * Burst coalescing: the first event for a quiet room is emitted immediately;
 * events arriving within this window afterwards are batched into one message.
 * A derby moment of 100 events in a second costs a room ~10 messages, not 20,
 * and clients render each batch once.
 */
const COALESCE_MS = 100;

/**
 * Client-facing fan-out layer.
 *
 * Each match maps to a Socket.IO room; a client subscribes to the match it is
 * watching and only ever receives that match's events — routing happens once
 * per event on the server, not per client. On subscribe the client immediately
 * gets a full `snapshot` (late joiners see the current score, not just future
 * events), then incremental `match:events` batches carrying the authoritative
 * derived state alongside each event.
 *
 * The lobby (match list + provider status) is also pushed, not polled: clients
 * join a lobby room and receive a `lobby:update` at most once per second, and
 * only when something actually changed — one serialization for every viewer
 * instead of one HTTP request per client per poll.
 */
@WebSocketGateway({ cors: { origin: '*' }, maxHttpBufferSize: 4096 })
export class LiveGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(LiveGateway.name);
  private readonly subscriptions: Subscription[] = [];

  private lobbyDirty = false;
  private lobbyTimer?: NodeJS.Timeout;

  private readonly pendingPushes = new Map<string, MatchEventPush[]>(); // room -> buffered batch
  private readonly coalesceTimers = new Map<string, NodeJS.Timeout>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly matchState: MatchStateService,
    private readonly statsProvider: StatsProviderService,
  ) {}

  afterInit(): void {
    this.subscriptions.push(
      this.matchState.updates$.subscribe((update) => this.fanOut(update)),
      this.matchState.listChanged$.subscribe(() => (this.lobbyDirty = true)),
      this.statsProvider.connectionChanged$.subscribe(() => (this.lobbyDirty = true)),
    );
    this.lobbyTimer = setInterval(() => this.broadcastLobbyIfDirty(), LOBBY_BROADCAST_MS);
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): void {
    const parsed = subscribePayloadSchema.safeParse(body);
    if (!parsed.success) {
      client.emit('subscribe:error', { message: 'expected { matchId: string }' });
      return;
    }
    const { matchId } = parsed.data;

    const snapshot = this.matchState.getSnapshot(matchId);
    if (!snapshot) {
      // don't join the room: otherwise the socket would silently receive
      // events with no snapshot baseline if this ID appears in a later cycle
      client.emit('subscribe:error', { message: `unknown match: ${matchId}` });
      return;
    }

    // one watched match per connection: leave any previous match room
    for (const room of client.rooms) {
      if (room.startsWith('match:')) client.leave(room);
    }
    client.join(roomFor(matchId));
    client.emit('snapshot', snapshot);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): void {
    const parsed = subscribePayloadSchema.safeParse(body);
    if (parsed.success) client.leave(roomFor(parsed.data.matchId));
  }

  @SubscribeMessage('lobby:subscribe')
  handleLobbySubscribe(@ConnectedSocket() client: Socket): void {
    client.join(LOBBY_ROOM);
    client.emit('lobby:update', this.lobbyPayload());
  }

  @SubscribeMessage('lobby:unsubscribe')
  handleLobbyUnsubscribe(@ConnectedSocket() client: Socket): void {
    client.leave(LOBBY_ROOM);
  }

  onModuleDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
    this.coalesceTimers.forEach((t) => clearTimeout(t));
  }

  // -------------------------------------------------------------------------

  private lobbyPayload(): LobbyUpdate {
    return {
      matches: this.matchState.listMatches(),
      provider: this.statsProvider.getProviderStatus(),
    };
  }

  private broadcastLobbyIfDirty(): void {
    if (!this.lobbyDirty) return;
    this.lobbyDirty = false;
    this.server.to(LOBBY_ROOM).emit('lobby:update', this.lobbyPayload());
  }

  private fanOut(update: MatchUpdate): void {
    const { matchId, ...push } = update;
    const room = roomFor(matchId);

    if (!this.coalesceTimers.has(room)) {
      // quiet room: deliver immediately, then open a coalescing window
      this.server.to(room).emit('match:events', [push]);
      this.coalesceTimers.set(
        room,
        setTimeout(() => this.flushRoom(room), COALESCE_MS),
      );
      return;
    }

    const buffer = this.pendingPushes.get(room) ?? [];
    buffer.push(push);
    this.pendingPushes.set(room, buffer);
  }

  private flushRoom(room: string): void {
    this.coalesceTimers.delete(room);
    const buffer = this.pendingPushes.get(room);
    if (!buffer || buffer.length === 0) return; // window closes quietly

    this.pendingPushes.delete(room);
    this.server.to(room).emit('match:events', buffer);
    // keep throttling while the burst is sustained
    this.coalesceTimers.set(
      room,
      setTimeout(() => this.flushRoom(room), COALESCE_MS),
    );
  }
}
