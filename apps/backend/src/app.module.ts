import { Module } from '@nestjs/common';
import { LiveGateway } from './gateway/live.gateway';
import { StatsProviderService } from './stats-provider/stats-provider.service';
import { MatchStateService } from './matches/match-state.service';
import { MatchesController } from './matches/matches.controller';

@Module({
  controllers: [MatchesController],
  providers: [MatchStateService, StatsProviderService, LiveGateway],
})
export class AppModule {}
