import type { MatchStatus } from '@koora/shared';

export function StatusBadge({ status, minute }: { status: MatchStatus; minute: number }) {
  const base =
    'inline-block rounded-full px-2 py-[2px] text-[0.7rem] font-bold tracking-[0.5px] whitespace-nowrap';
  if (status === 'LIVE') {
    return <span className={`${base} bg-live/15 text-live`}>LIVE {minute}&apos;</span>;
  }
  if (status === 'FINISHED') {
    return <span className={`${base} bg-muted/15 text-muted`}>FULL TIME</span>;
  }
  return <span className={`${base} bg-[#2a3240] text-muted`}>SCHEDULED</span>;
}
