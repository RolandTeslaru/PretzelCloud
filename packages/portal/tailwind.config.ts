import type { Config } from "tailwindcss";
import preset from "@pretzel-graph/standard-ui/tailwind-preset";

// Paths only. Theme, plugins and colours live in the preset.
const config: Config = {
    presets: [preset],
    content: [
        "./index.html",
        "./src/**/*.{js,ts,tsx,jsx}",
        // Utilities used inside shared components emit no CSS without this.
        "../../../PretzelGraph/packages/standard-ui/src/**/*.{js,ts,tsx,jsx}",
    ],
};

export default config;
