import { Module } from '@nestjs/common';
import { RouterModule } from '@/services/SiloRouter/router.module';
import { SiloTokenIssuerModule } from './token-issuer.module';
import { JwksController, SiloSessionController } from './session.controller';

@Module({
    imports:     [SiloTokenIssuerModule, RouterModule],
    controllers: [SiloSessionController, JwksController],
})
export class SiloSessionModule { }
