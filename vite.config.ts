import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    ...tailwindcss(),
    viteTsConfigPaths({ projects: ["./tsconfig.json"] }),
    ...viteReact(),
  ],
  resolve: {
    alias: {
      "@": `${process.cwd()}/src`,
    },
  },
});