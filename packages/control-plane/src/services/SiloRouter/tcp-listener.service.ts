import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import { ProxyService } from './proxy.service';

const DEFAULT_PORT = 8080;

// The router's port. Hands every request and upgrade to the proxy.
@Injectable()
export class TcpListener implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(TcpListener.name);

    private readonly tcpListener: Server;

    constructor(
        private readonly proxyService: ProxyService
    ) {
        this.tcpListener = createServer((req, res) => void this.proxyService.handle(req, res));

        this.tcpListener.on('upgrade', (req, socket, head) => void this.proxyService.handleWebSocketUpgrade(req, socket, head));
    }

    public onModuleInit(): void {
        const port = Number(process.env.FLEET_ROUTER_PORT ?? DEFAULT_PORT);

        this.tcpListener.listen(port, () => this.logger.log(`Router listening on http://localhost:${port}`));
    }

    public async onModuleDestroy(): Promise<void> {
        await new Promise<void>((resolve) => this.tcpListener.close(() => resolve()));
    }
}
