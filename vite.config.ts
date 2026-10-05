import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// В CI берём коммит, локально — время сборки. Главное, чтобы значение менялось
// каждый раз: от него зависит и адрес service worker, и имя кэша.
const release = (process.env.LAD_RELEASE_SHA ?? process.env.GITHUB_SHA ?? "").slice(0, 7)
  || new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);

export default defineConfig({
  define: {
    __RELEASE__: JSON.stringify(release)
  },
  // GitHub Pages раздаёт проектный сайт из подкаталога /<repo>/, а свой домен —
  // из корня. Базовый путь задаётся переменной окружения при сборке, чтобы
  // один и тот же код работал в обоих случаях.
  base: process.env.PAGES_BASE ?? "/",
  plugins: [react(), {
    name: "release-html",
    transformIndexHtml(html) {
      const boot = html.match(/    <script>\s*window\.__ladBootComplete = false;[\s\S]*?<\/script>/)?.[0];
      const prepared = boot ? html.replace(boot, "").replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n${boot}`) : html;
      return prepared.replace('"__HTML_RELEASE__"', JSON.stringify(release))
        .replace(/<meta name="lad-release" content="[^"]*"/, `<meta name="lad-release" content="${release}"`);
    }
  }, {
    name: "atomic-offline-shell",
    async writeBundle(options, bundle) {
      const file = resolve(options.dir || "dist", "sw.js");
      const assets = Object.keys(bundle).filter((name) => /\.(js|css)$/.test(name));
      const worker = await readFile(file, "utf8");
      await writeFile(file, worker
        .replace('"__BUILD_RELEASE__"', JSON.stringify(release))
        .replace('/* __BUILD_ASSETS__ */ null', JSON.stringify(assets)));
    }
  }],
  server: {
    port: 5173,
    proxy: {
      "/vlsu-api": {
        target: "https://abiturient-api.vlsu.ru/api",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/vlsu-api/, "")
      }
    }
  }
});
