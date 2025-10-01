import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, normalizeBunSnapshot } from "harness";
import { join } from "path";
import { tempDirWithBakeDeps } from "./bake-harness";

test(
  "bake production build generates manifest with SSR and SSG pages",
  async () => {
    const dir = await tempDirWithBakeDeps("bake-ssr-manifest", {
    "index.ts": `
      export default {
        app: "react"
      }
    `,
    "pages/index.tsx": `
      export default function IndexPage() {
        return <div>Static Home Page</div>;
      }
    `,
    "pages/about.tsx": `
      // This is a server-side rendered page
      export const mode = 'ssr';
      
      export default function AboutPage({ request }) {
        return <div>SSR About Page</div>;
      }
    `,
    "pages/blog/[slug].tsx": `
      // This is a server-side rendered dynamic page
      export const mode = 'ssr';
      
      export default function BlogPost({ request, params }) {
        return <div>SSR Blog Post - slug: {params?.slug}</div>;
      }
    `,
  });

  // Run the production build
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--app", "./index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Debug output
  if (exitCode !== 0) {
    console.log("Build failed!");
    console.log("STDOUT:", stdout);
    console.log("STDERR:", stderr);
  }

  expect(exitCode).toBe(0);

  // Check that manifest.json is generated
  const manifestPath = join(String(dir), "dist", "manifest.json");
  const manifestFile = await Bun.file(manifestPath);
  expect(await manifestFile.exists()).toBe(true);

  // Read and check manifest
  const manifest = await manifestFile.json();

  expect(manifest.version).toBe("0.0.1");
  expect(manifest.routes).toBeDefined();

  // Sort by route for consistent ordering
  manifest.routes.sort((a, b) => a.route.localeCompare(b.route));

  // Replace dynamic file hashes with placeholders for comparison
  const normalizedManifest = {
    version: manifest.version,
    routes: manifest.routes.map(entry => ({
      ...entry,
      client_entrypoint: entry.client_entrypoint ? "/_bun/[hash].js" : undefined,
      modules: entry.modules?.map(() => "_bun/[hash].js"),
      entrypoint: entry.entrypoint ? "_bun/[hash].js" : undefined,
    })),
  };

  expect(normalizedManifest).toMatchInlineSnapshot(`
    {
      "routes": [
        {
          "client_entrypoint": "/_bun/[hash].js",
          "entrypoint": undefined,
          "mode": "ssr",
          "modules": [
            "_bun/[hash].js",
          ],
          "route": "/about",
          "route_type": 0,
          "styles": [],
        },
        {
          "client_entrypoint": "/_bun/[hash].js",
          "entrypoint": undefined,
          "mode": "ssr",
          "modules": [
            "_bun/[hash].js",
          ],
          "route": "/blog/[slug]",
          "route_type": 0,
          "styles": [],
        },
        {
          "client_entrypoint": undefined,
          "entrypoint": "_bun/[hash].js",
          "mode": "ssg",
          "modules": undefined,
          "route": "/index",
          "route_type": 0,
          "styles": [],
        },
      ],
      "version": "0.0.1",
    }
  `);
  },
  30000,
);

test(
  "bake production build generates manifest with multiple SSG pages under the same route",
  async () => {
    const dir = await tempDirWithBakeDeps("bake-ssg-manifest", {
    "index.ts": `
      export default {
        app: "react"
      }
    `,
    "pages/blog/[slug].tsx": `
      // This is an SSG page with multiple static paths
      
      export default function BlogPost({ params }) {
        return <div>SSG Blog Post - slug: {params?.slug}</div>;
      }

      export async function getStaticPaths() {
          return {
              pages: [
                  { slug: 'lmao' },
                  { slug: 'lolfucku' },
              ]
          }
      }

    `,
  });

  // Run the production build
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--app", "./index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Debug output
  if (exitCode !== 0) {
    console.log("Build failed!");
    console.log("STDOUT:", stdout);
    console.log("STDERR:", stderr);
  }

  expect(exitCode).toBe(0);

  // Check that manifest.json is generated
  const manifestPath = join(String(dir), "dist", "manifest.json");
  const manifestFile = await Bun.file(manifestPath);
  expect(await manifestFile.exists()).toBe(true);

  // Read and check manifest
  const manifest = await manifestFile.json();

  expect(manifest.version).toBe("0.0.1");
  expect(manifest.routes).toBeDefined();

  // Sort by route then by params for consistent ordering
  manifest.routes.sort((a, b) => {
    const routeCmp = a.route.localeCompare(b.route);
    if (routeCmp !== 0) return routeCmp;
    return JSON.stringify(a.params || {}).localeCompare(JSON.stringify(b.params || {}));
  });

  // Replace dynamic file hashes with placeholders for comparison
  const normalizedManifest = {
    version: manifest.version,
    routes: manifest.routes.map(entry => ({
      ...entry,
      entrypoint: entry.entrypoint ? "_bun/[hash].js" : undefined,
    })),
  };

  expect(normalizedManifest).toMatchInlineSnapshot(`
    {
      "routes": [
        {
          "entrypoint": "_bun/[hash].js",
          "mode": "ssg",
          "params": {
            "slug": "lmao",
          },
          "route": "/blog/[slug]",
          "route_type": 0,
          "styles": [],
        },
        {
          "entrypoint": "_bun/[hash].js",
          "mode": "ssg",
          "params": {
            "slug": "lolfucku",
          },
          "route": "/blog/[slug]",
          "route_type": 0,
          "styles": [],
        },
      ],
      "version": "0.0.1",
    }
  `);
  },
  30000,
);
