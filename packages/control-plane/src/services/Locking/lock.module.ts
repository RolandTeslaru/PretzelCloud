import { Global, Module } from '@nestjs/common';
import { LockService } from './lock.service';

// Global: anything that must happen once across the fleet takes one of these,
// and which services do is not a dependency worth declaring per module.
@Global()
@Module({
    providers: [LockService],
    exports:   [LockService],
})
export class LockModule { }
