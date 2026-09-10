import type { ReactNode } from 'react'
import pretzelLogo from '@/assets/pretzel-logo.png'

/**
 * The signed-out shell, the same shape as the editor's: a panel docked to the
 * left over the dither the root draws, with the mark above whatever is inside.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <div className="relative min-h-screen overflow-hidden">
            <div className="absolute left-0 z-10 flex h-full w-full rounded-r-2xl bg-background/70 p-10 backdrop-blur-lg xl:w-[900px]">
                <div className="m-auto w-full max-w-md">
                    <div className='flex flex-row w-fit mr-auto gap-4 mb-8'>
                        <img src={pretzelLogo} alt="PretzelGraph" width={50} height={50} className="block" />
                        <p className="text-xl h-auto my-auto font-semibold">PretzelGraph</p>
                    </div>
                    {children}
                </div>
            </div>
        </div>
    )
}
