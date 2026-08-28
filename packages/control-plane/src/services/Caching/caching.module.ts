import { Global, Module } from '@nestjs/common';
import { RealtimeModule } from '@/services/Realtime/realtime.module';
import { GlobalCachingService } from './caching.service';

// Global: any service may hold a cache, and which ones do is not a dependency
// worth declaring per module.
@Global()
@Module({
    imports:   [RealtimeModule],
    providers: [GlobalCachingService],
    exports:   [GlobalCachingService],
})
export class CachingModule { }
