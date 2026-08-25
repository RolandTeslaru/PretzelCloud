import MagicString from 'magic-string'
import type { Plugin } from 'vite'

const BRAND_LABEL = /\.brand\((['"])[A-Za-z0-9_.$-]*\1\)/g

/** Drops Zod brand labels from browser output; `brand()` ignores them at runtime. */
export function stripBrandLabels(pathFragment: string): Plugin {

    return {
        name: 'strip-brand-labels',
        apply: 'build',

        transform(code, id) {

            if (!id.includes(pathFragment)) {
                return null
            }

            if (!code.includes('.brand(')) {
                return null
            }

            const s = new MagicString(code)

            BRAND_LABEL.lastIndex = 0

            let match: RegExpExecArray | null

            while ((match = BRAND_LABEL.exec(code)) !== null) {
                s.overwrite(match.index, match.index + match[0].length, '.brand()')
            }

            return {
                code: s.toString(),
                map: s.generateMap({ hires: true }),
            }
        },
    }
}
