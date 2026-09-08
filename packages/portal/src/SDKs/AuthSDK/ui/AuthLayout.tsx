import type { ReactNode } from 'react'
import { SystemIcons } from '@pretzel-graph/standard-ui/icons'

/**
 * The signed-out shell, the same shape as the editor's: a panel docked to the
 * left over the dither the root draws, with the mark above whatever is inside.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <div className="relative min-h-screen overflow-hidden">
            <div className="absolute left-0 z-10 flex h-full w-full rounded-r-2xl bg-background/70 p-10 backdrop-blur-lg xl:w-[900px]">
                <div className="m-auto w-full max-w-md">
                    <SystemIcons.Pretzel className="text-primary mx-auto mb-4" size={80} />

                    {children}
                </div>
            </div>
        </div>
    )
}
