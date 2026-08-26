import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { stripBrandLabels } from './plugins/strip-brand-labels'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

// standard-ui is linked from a sibling checkout, so its sources resolve outside
// this project root.
const standardUi = path.resolve(here, '../../../PretzelGraph/packages/standard-ui')

// Overridable so a second control plane can be developed against without
// moving the one this normally talks to.
const CONTROL_PLANE_PORT = process.env.CONTROL_PLANE_PORT ?? '4000';
const PORTAL_PORT        = Number(process.env.PORTAL_PORT ?? 5174);

export default defineConfig({
    envDir: '../../',
    server: {
        port: PORTAL_PORT,
        proxy: {
            '/api': { target: `http://localhost:${CONTROL_PLANE_PORT}`, changeOrigin: true },
            '/socket': { target: `ws://localhost:${CONTROL_PLANE_PORT}`, ws: true },
        },
        fs: {
            allow: [here, standardUi],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(here, 'src'),
        },
        // A linked package resolves its own copy otherwise. Two Reacts break
        // hooks, two react-hook-forms break form-to-field context, and two
        // zustands give the shared SDKs a second, unread store, and two
        // tsyringes give the SDK registry a second, empty container.
        dedupe: ['react', 'react-dom', 'react-hook-form', 'zustand', 'immer', 'tsyringe', 'reflect-metadata', '@tanstack/react-query', 'sonner'],
    },
    plugins: [
        tanstackRouter(),
        react({
            babel: {
                plugins: [
                    ["@babel/plugin-proposal-decorators", { version: "legacy" }],
                    ["@babel/plugin-proposal-class-properties", { loose: true }],
                ],
            },
        }),
        tailwindcss(),
        stripBrandLabels('packages/shared'),
    ],
})
