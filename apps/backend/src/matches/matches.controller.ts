import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { MatchSnapshot, MatchSummary } from '@koora/shared';
import { MatchStateService } from './match-state.service';

@Controller('api/matches')
export class MatchesController {
  constructor(private readonly matchState: MatchStateService) {}

  @Get()
  list(): MatchSummary[] {
    return this.matchState.listMatches();
  }

  @Get(':matchId')
  get(@Param('matchId') matchId: string): MatchSnapshot {
    const snapshot = this.matchState.getSnapshot(matchId);
    if (!snapshot) throw new NotFoundException(`unknown match: ${matchId}`);
    return snapshot;
  }
}
