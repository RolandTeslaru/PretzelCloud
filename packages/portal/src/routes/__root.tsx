import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { DialogSDK } from "@pretzel-graph/standard-ui/SDKs/DialogSDK";
import { NotificationSDK } from "@pretzel-graph/standard-ui/SDKs/NotificationSDK";
import { QuerySDK } from "@pretzel-graph/standard-ui/SDKs/QuerySDK/sdk";
import type { AuthSDK } from "@/SDKs/AuthSDK/sdk";
import {
    Dither,
    ditherCtx,
} from "@pretzel-graph/standard-ui/components/Dither";
import { SystemSDK } from "@pretzel-graph/standard-ui/SDKs/SystemSDK";

interface RouterContext {
    auth: AuthSDK.State;
}

export const Route = createRootRouteWithContext<RouterContext>()({
    component: () => {
        const theme = SystemSDK.useStore((s) => s.resolvedTheme);

        return (
            <QuerySDK.Provider>
                <NotificationSDK.UIOverlay />
                <DialogSDK.UIOverlay />
                <div className="z-10 ">
                    <Outlet />
                </div>

                <div className="absolute top-0 left-0 z-[-1] w-full h-full">
                    <Dither

                        ctx={ditherCtx}
                        waveColorVar="--primary"
                        bgColor={theme === "dark" ? [0.08, 0.08, 0.08] : [0.88, 0.88, 0.88]}
                        disableAnimation={false}
                        enableMouseInteraction={false}
                        mouseRadius={0.3}
                        colorNum={5.5}
                        waveAmplitude={0.2}
                        waveFrequency={1.4}
                        waveSpeed={0.05}
                    />
                </div>
            </QuerySDK.Provider>
        );
    },
});
