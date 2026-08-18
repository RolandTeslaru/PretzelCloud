import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

// standard-ui is linked from a sibling checkout, so its sources resolve outside
// this project root.
const standardUi = path.resolve(here, '../../../PretzelGraph/packages/standard-ui')

export default defineConfig({
    envDir: '../../',
    server: {
        port: 5174,
        proxy: {
            '/api': { target: 'http://localhost:4000', changeOrigin: true },
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
    ],
})
