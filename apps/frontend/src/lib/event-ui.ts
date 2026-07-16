import type { EventType, MatchEvent } from '@koora/shared';

export const ICONS: Record<EventType, string> = {
  GOAL: '⚽',
  YELLOW_CARD: '🟨',
  RED_CARD: '🟥',
  SUBSTITUTION: '🔁',
  KICK_OFF: '▶️',
  FULL_TIME: '🏁',
};

export function describeEvent(event: MatchEvent): string {
  switch (event.type) {
    case 'KICK_OFF': return 'Kick-off';
    case 'FULL_TIME': return 'Full time';
    case 'GOAL': return `Goal — ${event.player ?? ''}`;
    case 'YELLOW_CARD': return `Yellow card — ${event.player ?? ''}`;
    case 'RED_CARD': return `Red card — ${event.player ?? ''}`;
    case 'SUBSTITUTION': return `Substitution — ${event.player ?? ''}`;
  }
}
