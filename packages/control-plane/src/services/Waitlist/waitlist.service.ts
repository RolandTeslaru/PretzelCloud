import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Resend } from 'resend';
import { Waitlist } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { LockService } from '@/services/Locking/lock.service';
import { WaitlistRepository } from './waitlist.repository';

const SENDER = 'PretzelCloud <hello@pretzelgraph.ai>';

const REPLY_TO = 'hello@pretzelgraph.ai';

const SWEEP_MS = 15 * 60_000;

// Leaves a just-joined address to the send its join already started.
const SWEEP_GRACE_MS = 5 * 60_000;

const SWEEP_BATCH = 50;

const SWEEP_LOCK = 'waitlist-thank-you';

@Injectable()
export class WaitlistService implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(WaitlistService.name);

    private sweepTimer: NodeJS.Timeout | null = null;

    // Made at init, once the environment is loaded; null means emails are off.
    private resend: Resend | null = null;

    // The thank-you's subject and body are edited in Resend, not here.
    private templateId: string | null = null;

    constructor(
        private readonly waitlistRepository: WaitlistRepository,
        private readonly lockService:        LockService,
    ) {}


    public onModuleInit(): void {
        const apiKey = process.env.RESEND_API_KEY;

        const templateId = process.env.RESEND_WAITLIST_TEMPLATE_ID;

        if (!apiKey || !templateId) {
            this.logger.warn('RESEND_API_KEY or RESEND_WAITLIST_TEMPLATE_ID is unset; waitlist thank-you emails are off');

            return;
        }

        this.resend = new Resend(apiKey);

        this.templateId = templateId;

        this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);

        // Don't keep the event loop alive just for the sweep.
        this.sweepTimer.unref();
    }


    public onModuleDestroy(): void {
        if (this.sweepTimer)
            clearInterval(this.sweepTimer);

        this.sweepTimer = null;
    }


    public async join(email: Waitlist.Email): Promise<void> {
        const isNew = await this.waitlistRepository.add(Principal.SELF, email);

        // Only a new address is thanked, and the visitor's answer does not wait for the email.
        if (isNew)
            void this.sendThankYou(email);
    }


    /** Retries whatever a join could not send: an outage, or the provider's daily cap. */
    private async sweep(): Promise<void> {
        // Silent when refused: another instance sweeping is the expected case.
        await this.lockService.withDurableLock(SWEEP_LOCK, 'all', () => this.sweepHeld());
    }


    private async sweepHeld(): Promise<void> {
        try {
            const joinedBefore = new Date(Date.now() - SWEEP_GRACE_MS);

            const emails = await this.waitlistRepository.getUnthanked(Principal.SELF, joinedBefore, SWEEP_BATCH);

            for (const email of emails) {
                const sent = await this.sendThankYou(email);

                // Whatever stopped this one stops the rest; the next sweep tries again.
                if (!sent)
                    return;
            }
        }
        catch (error) {
            this.logger.error(`Waitlist thank-you sweep failed: ${error instanceof Error ? error.message : error}`);
        }
    }


    /** Never throws: an address that was not sent to stays for the sweep. */
    private async sendThankYou(email: Waitlist.Email): Promise<boolean> {
        if (!this.resend || !this.templateId)
            return false;

        try {
            const { error } = await this.resend.emails.send(
                {
                    from:     SENDER,
                    to:       [email],
                    replyTo:  REPLY_TO,
                    template: { id: this.templateId },
                },
                // A retry within a day cannot send the same address a second email.
                { idempotencyKey: `waitlist-thank-you/${email}` },
            );

            if (error) {
                this.logger.warn(`Could not send a waitlist thank-you: Resend refused it: ${error.name}: ${error.message}`);

                return false;
            }

            await this.waitlistRepository.markThankYouSent(Principal.SELF, email);

            return true;
        }
        catch (error) {
            this.logger.warn(`Could not send a waitlist thank-you: ${error instanceof Error ? error.message : error}`);

            return false;
        }
    }
}
