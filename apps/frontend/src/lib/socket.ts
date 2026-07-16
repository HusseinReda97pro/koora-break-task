import { io, Socket } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

let socket: Socket | undefined;

/**
 * One Socket.IO connection shared by the whole app; pages (re)establish their
 * own subscriptions (lobby room / match room) as the user navigates.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(BACKEND_URL, { transports: ['websocket'] });
  }
  return socket;
}
