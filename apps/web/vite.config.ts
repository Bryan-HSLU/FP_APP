import { createReadStream, existsSync, statSync } from "node:fs";
import { cp, mkdir, readdir } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// apps/web/vite.config.ts → Repo-Root ist zwei Ebenen höher.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BILDER_QUELLE = join(REPO_ROOT, "data", "images");

const ERLAUBTE_ENDUNGEN: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/** Sammelt rekursiv alle Bilddateien unter `dir` und liefert ihre Pfade
 *  relativ zu `basis`. JSON-Kataloge (bad.json …) auf oberster Ebene fallen
 *  automatisch raus, weil ihre Endung nicht in `ERLAUBTE_ENDUNGEN` steht. */
async function sammleBilder(dir: string, basis: string): Promise<string[]> {
  const eintraege = await readdir(dir, { withFileTypes: true });
  const treffer: string[] = [];
  for (const eintrag of eintraege) {
    const pfad = join(dir, eintrag.name);
    if (eintrag.isDirectory()) {
      treffer.push(...(await sammleBilder(pfad, basis)));
    } else if (ERLAUBTE_ENDUNGEN[extname(eintrag.name).toLowerCase()] !== undefined) {
      treffer.push(relative(basis, pfad));
    }
  }
  return treffer;
}

/** Liefert die Swipe-/Preset-Fotos aus `data/images/` statisch unter `/bilder/...`
 *  aus – künftig per CDN statt über das Python-Backend, weil der Vercel-Proxy
 *  im Frontend-Hosting nur `/api/*` ans Backend weiterleitet. Das Backend-Mount
 *  `/api/bilder` bleibt daneben bestehen (z. B. für lokale Dev-Setups ohne
 *  diesen Plugin-Pfad). Die JSON-Kataloge auf oberster Ebene von `data/images/`
 *  werden bewusst nie ausgeliefert. */
function fpBilder(): Plugin {
  let outDir = "dist";
  let istBuild = false;

  return {
    name: "fp-bilder",
    configResolved(config) {
      outDir = isAbsolute(config.build.outDir)
        ? config.build.outDir
        : join(config.root, config.build.outDir);
      istBuild = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        const pathname = new URL(req.url ?? "", "http://localhost").pathname;
        if (!pathname.startsWith("/bilder/")) {
          next();
          return;
        }
        let dekodiert: string;
        try {
          dekodiert = decodeURIComponent(pathname.slice("/bilder/".length));
        } catch {
          next();
          return;
        }
        const contentType = ERLAUBTE_ENDUNGEN[extname(dekodiert).toLowerCase()];
        if (contentType === undefined) {
          next();
          return;
        }
        // Path-Traversal-Schutz: der aufgelöste Pfad muss innerhalb von
        // data/images bleiben (auch bei "../"-Sequenzen im dekodierten Pfad).
        const aufgeloest = resolve(BILDER_QUELLE, dekodiert);
        const relativ = relative(BILDER_QUELLE, aufgeloest);
        if (relativ.startsWith("..") || isAbsolute(relativ)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (!existsSync(aufgeloest) || !statSync(aufgeloest).isFile()) {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        createReadStream(aufgeloest).pipe(res);
      });
    },
    async closeBundle() {
      // closeBundle feuert je nach Vite-Version auch beim Beenden des
      // Dev-Servers – kopiert wird aber nur beim echten Build.
      if (!istBuild || !existsSync(BILDER_QUELLE)) return;
      const bilder = await sammleBilder(BILDER_QUELLE, BILDER_QUELLE);
      const ziel = join(outDir, "bilder");
      await Promise.all(
        bilder.map(async (relPfad) => {
          const quelle = join(BILDER_QUELLE, relPfad);
          const zielPfad = join(ziel, relPfad);
          await mkdir(join(zielPfad, ".."), { recursive: true });
          await cp(quelle, zielPfad);
        }),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), fpBilder()],
  server: {
    // Im lokalen Netz erreichbar (Handy-Browser, POC-Bauumfang)
    host: true,
    proxy: {
      // Engines-API (FastAPI) – ein Origin, kein CORS-Gefummel im POC
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
