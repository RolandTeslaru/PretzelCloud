import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Module, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SignJWT } from 'jose';
import { User, Workspace } from '@pretzel-cloud/shared/domain';
import { Principal } from '@/auth/identity/principal';
import { IdentityResolver, TokenIdentityResolver } from '@/auth/identity/identity';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { requireAdmin } from '@/auth/admin';
import { AdminRepository } from '@/auth/admin.repository';
import { WorkspaceAdminController } from '@/services/Workspace/workspace.admin.controller';
import { WorkspaceAdminService } from '@/services/Workspace/workspace.admin.service';
import { WorkspaceService } from '@/services/Workspace/workspace.service';
import { LockService } from '@/services/Locking/lock.service';
import { ProvisioningService } from '@/services/Fleet/provisioning/provisioning.service';
import { UserController } from '@/services/User/user.controller';
import { UserService } from '@/services/User/user.service';
import { ZodExceptionFilter } from '@/filters/zod-exception.filter';

const admin: Principal.User = { type: 'user', userId: User.Id.parse('11111111-1111-4111-8111-111111111111'), email: 'admin@example.test' };
const adminUser = Principal.AdminUser.Schema.parse(admin);
const owner: Principal.User = { type: 'user', userId: User.Id.parse('22222222-2222-4222-8222-222222222222'), email: 'owner@example.test' };
const workspaceId = Workspace.Id.parse('33333333-3333-4333-8333-333333333333');
const quietLogger = { log() {}, warn() {}, error() {} };

/** Real orchestration and operation locks with in-memory infrastructure boundaries. */
function harness() {
    const calls: string[] = [];
    let failure: string | undefined;
    let exists = true;
    let busy = false;
    const admins = new Set<User.Id>([admin.userId]);
    const step = (name: string) => async () => {
        calls.push(name);
        if (failure === name) throw new Error(`${name} failed`);
    };
    const workspace = { id: workspaceId, displayName: 'Customer workspace', ownerId: owner.userId, subdomain: null } as Workspace;
    const provisioning = Object.assign(Object.create(ProvisioningService.prototype), {
        logger: quietLogger,
        hardware: { lifecycle: { stopAll: step('stop') }, destroy: step('hardware') },
        hostname: { delete: step('hostnames') },
        siloSecrets: { delete: step('secrets') },
    }) as ProvisioningService;
    const adminRepository = {
        isAdmin: async (principal: Principal.Service, userId: User.Id) => {
            assert.equal(principal, Principal.SELF);

            return admins.has(userId);
        },
    } as unknown as AdminRepository;
    const repository = {
        get: async () => { if (!exists) throw new NotFoundException(); return workspace; },
        delete: async (principal: Principal.User) => { assert.equal(principal, owner); await step('user-row')(); exists = false; },
    };
    const workspaceAdminRepository = {
        list: async (): Promise<Workspace[]> => [],
        delete: async (principal: Principal.Service) => { assert.equal(principal, Principal.SELF); await step('admin-row')(); exists = false; },
    };
    const userAdminRepository = {
        getByIds: async (): Promise<User[]> => [],
    };
    const lockService = {
        withDurableLock: async (_namespace: string, id: string, fn: () => Promise<unknown>) => {
            assert.equal(id, workspaceId);
            return busy ? null : fn();
        },
    };
    const service = Object.assign(Reflect.construct(WorkspaceService, []), {
        logger: quietLogger,
        provisioning,
        lockService,
        repository,
        billing: { cancelSubscription: step('billing') },
        permission: { invalidateCloudToken: () => { calls.push('token'); } },
        listing: { deleteAllForWorkspace: step('listings') },
        siloRouter: { invalidate: () => { calls.push('router'); } },
        realtime: { publish: () => { calls.push('event'); } },
    }) as WorkspaceService;
    const adminService = Object.assign(Reflect.construct(WorkspaceAdminService, []), {
        logger: quietLogger,
        workspaceService: service,
        workspaceAdminRepository,
        userAdminRepository,
        lockService,
    }) as WorkspaceAdminService;
    return { service, adminService, workspaceAdminRepository, userAdminRepository, adminRepository, admins, calls, workspace, lockService, setFailure: (name?: string) => { failure = name; }, setBusy: () => { busy = true; }, exists: () => exists };
}

test('admin workspace deletion and access', async (t) => {
    const previousSecret = process.env.AUTH_JWT_SECRET;
    process.env.AUTH_JWT_SECRET = 'admin-tests-only-secret';
    t.after(() => {
        if (previousSecret === undefined) delete process.env.AUTH_JWT_SECRET;
        else process.env.AUTH_JWT_SECRET = previousSecret;
    });

    await t.test('only users flagged is_admin pass, everyone else gets not found', async () => {
        const h = harness();

        const proven = await requireAdmin(h.adminRepository, admin);

        assert.equal(proven.userId, admin.userId);

        for (const principal of [undefined, owner, Principal.SELF, { type: 'silo', workspaceId } as const])
            await assert.rejects(requireAdmin(h.adminRepository, principal), NotFoundException);

        h.admins.clear();

        await assert.rejects(requireAdmin(h.adminRepository, admin), NotFoundException);
    });

    await t.test('an admin deletes another owner’s workspace through full cleanup', async () => {
        const h = harness();
        await h.adminService.destroy(adminUser, workspaceId, h.workspace.displayName);
        assert.deepEqual(h.calls, ['billing', 'token', 'stop', 'hardware', 'hostnames', 'secrets', 'listings', 'admin-row', 'router', 'event']);
        assert.equal(h.exists(), false);
    });

    await t.test('mismatched confirmations and the owner path cause no destructive side effects', async () => {
        const h = harness();
        await assert.rejects(h.adminService.destroy(adminUser, workspaceId, 'customer workspace'), BadRequestException);
        await assert.rejects(h.adminService.destroy(adminUser, workspaceId, ''), BadRequestException);
        await assert.rejects(h.service.destroy(admin, workspaceId), ForbiddenException);
        assert.deepEqual(h.calls, []);
    });

    await t.test('the current name is checked so renamed workspaces require fresh confirmation', async () => {
        const h = harness();
        h.workspace.displayName = 'Renamed';
        await assert.rejects(h.adminService.destroy(adminUser, workspaceId, 'Customer workspace'), BadRequestException);
        assert.deepEqual(h.calls, []);
    });

    await t.test('busy workspaces refuse deletion before any cleanup', async () => {
        const h = harness();
        h.setBusy();
        await assert.rejects(h.adminService.destroy(adminUser, workspaceId, h.workspace.displayName), ConflictException);
        assert.deepEqual(h.calls, []);
    });

    await t.test('a missing workspace returns not found before cleanup', async () => {
        const h = harness();
        await h.adminService.destroy(adminUser, workspaceId, h.workspace.displayName);
        h.calls.length = 0;
        await assert.rejects(h.adminService.destroy(adminUser, workspaceId, h.workspace.displayName), NotFoundException);
        assert.deepEqual(h.calls, []);
    });

    for (const failedStep of ['billing', 'hardware', 'hostnames', 'secrets', 'listings', 'admin-row']) {
        await t.test(`${failedStep} failure keeps the workspace for retry`, async () => {
            const h = harness();
            h.setFailure(failedStep);
            await assert.rejects(h.adminService.destroy(adminUser, workspaceId, h.workspace.displayName), new RegExp(`${failedStep} failed`));
            assert.equal(h.exists(), true);
            assert.equal(h.calls.at(-1), failedStep);
            h.setFailure();
            await h.adminService.destroy(adminUser, workspaceId, h.workspace.displayName);
            assert.equal(h.exists(), false);
        });
    }

    await t.test('owners retain their normal deletion path', async () => {
        const h = harness();
        await h.service.destroy(owner, workspaceId);
        assert.equal(h.calls.includes('user-row'), true);
        assert.equal(h.calls.includes('admin-row'), false);
    });

    await t.test('HTTP endpoints enforce signed identity, the admin flag, and body validation', async () => {
        const h = harness();
        const profile = (principal: Principal.User) => ({ id: principal.userId, email: principal.email, isAdmin: h.admins.has(principal.userId) });
        @Module({
            controllers: [WorkspaceAdminController, UserController],
            providers: [
                UserAuthGuard, AdminGuard,
                { provide: IdentityResolver, useClass: TokenIdentityResolver },
                { provide: AdminRepository, useValue: h.adminRepository },
                { provide: WorkspaceAdminService, useValue: h.adminService },
                { provide: LockService, useValue: h.lockService },
                { provide: UserService, useValue: { get: profile, register: profile } },
            ],
        })
        class TestModule {}

        const app = await NestFactory.create(TestModule, { logger: false, abortOnError: false });
        app.setGlobalPrefix('api');
        app.useGlobalFilters(new ZodExceptionFilter());
        await app.listen(0, '127.0.0.1');
        const url = await app.getUrl();
        const token = (principal: Principal.User) => new SignJWT({ email: principal.email })
            .setProtectedHeader({ alg: 'HS256' }).setSubject(principal.userId).setAudience('authenticated')
            .setExpirationTime('5m').sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET));
        const adminHeaders = { Authorization: `Bearer ${await token(admin)}`, 'Content-Type': 'application/json' };
        const ownerHeaders = { Authorization: `Bearer ${await token(owner)}`, 'Content-Type': 'application/json' };

        try {
            for (const path of ['/api/admin/workspaces', `/api/admin/workspaces/${workspaceId}`]) {
                const method = path.endsWith(workspaceId) ? 'DELETE' : 'GET';
                assert.equal((await fetch(url + path, { method })).status, 401);
                assert.equal((await fetch(url + path, { method, headers: { Authorization: 'Bearer forged' } })).status, 401);
                assert.equal((await fetch(url + path, { method, headers: ownerHeaders })).status, 404);
            }
            assert.equal((await (await fetch(url + '/api/me', { headers: adminHeaders })).json()).user.isAdmin, true);
            assert.equal((await (await fetch(url + '/api/me', { headers: ownerHeaders })).json()).user.isAdmin, false);

            h.workspaceAdminRepository.list = async () => [h.workspace];
            h.userAdminRepository.getByIds = async () => [{ id: owner.userId, email: owner.email } as User];

            const response = await fetch(url + '/api/admin/workspaces', { headers: adminHeaders });
            assert.equal(response.status, 200);

            const body = await response.json();
            assert.equal(body.workspaces[0].workspace.id, workspaceId);
            assert.equal(body.workspaces[0].owner.email, owner.email);

            const destroy = (id: string, body: unknown) => fetch(`${url}/api/admin/workspaces/${id}`, { method: 'DELETE', headers: adminHeaders, body: JSON.stringify(body) });
            assert.equal((await destroy('invalid-id', { confirmation: h.workspace.displayName })).status, 400);
            for (const body of [{}, { confirmation: '' }, { confirmation: 42 }, { confirmation: 'wrong name' }])
                assert.equal((await destroy(workspaceId, body)).status, 400);
            assert.deepEqual(h.calls, []);

            h.admins.delete(admin.userId);
            assert.equal((await destroy(workspaceId, { confirmation: h.workspace.displayName })).status, 404);
            h.admins.add(admin.userId);

            assert.equal((await destroy(workspaceId, { confirmation: h.workspace.displayName })).status, 204);
            assert.equal(h.exists(), false);
        } finally { await app.close(); }
    });
});
