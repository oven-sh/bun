import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, normalizeBunSnapshot } from "harness";
import { join } from "path";
import { tempDirWithBakeDeps } from "./bake-harness";

test("bake production build generates manifest with SSR and SSG pages", async () => {
  const dir = await tempDirWithBakeDeps("bake-ssr-manifest", {
    "bun.app.ts": `
      export default {
        app: {
          framework: "react"
        }
      }
    `,
    "package.json": `{
      "dependencies": {
        "react": "experimental",
        "react-dom": "experimental",
        "react-server-dom-bun": "experimental",
        "react-refresh": "experimental"
      }
    }`,
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
    cmd: [bunExe(), "build", "--app", "bun.app.ts"],
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

  // expect(manifest.version).toBe(1);
  // expect(manifest.entries).toBeDefined();

  // Sort by route_index for consistent ordering
  // manifest.entries.sort((a, b) => a.route_index - b.route_index);

  // Replace dynamic file hashes with placeholders for comparison
  // const normalizedManifest = {
  //   version: manifest.version,
  //   entries: manifest.entries.map(entry => ({
  //     ...entry,
  //     client_entrypoint: entry.client_entrypoint ? "/_bun/[hash].js" : undefined,
  //     modules: entry.modules?.map(() => "_bun/[hash].js"),
  //     entrypoint: entry.entrypoint,
  //   })),
  // };

  expect(manifest).toMatchInlineSnapshot(`
    {
      "entries": [
        {
          "entrypoint": "_bun/wkhr98c0.js",
          "mode": "ssg",
          "route_index": 0,
          "styles": [],
        },
        {
          "client_entrypoint": "/_bun/htsytxwp.js",
          "mode": "ssr",
          "modules": [
            "_bun/knkf935z.js",
          ],
          "route_index": 1,
          "styles": [],
        },
        {
          "client_entrypoint": "/_bun/htsytxwp.js",
          "mode": "ssr",
          "modules": [
            "_bun/3jrnaj10.js",
          ],
          "route_index": 2,
          "styles": [],
        },
      ],
      "version": 1,
    }
  `);
});

test("bake production build generates manifest with multiple SSG pages under the same route", async () => {
  const dir = await tempDirWithBakeDeps("bake-ssg-manifest", {
    "bun.app.ts": `
      export default {
        app: {
          framework: "react"
        }
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
    cmd: [bunExe(), "build", "--app", "bun.app.ts"],
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

  expect(manifest).toMatchInlineSnapshot(`
    {
      "entries": [
        {
          "entrypoint": "_bun/k9n7hkw3.js",
          "mode": "ssg",
          "params": {
            "slug": "lmao",
          },
          "route_index": 0,
          "styles": [],
        },
        {
          "entrypoint": "_bun/k9n7hkw3.js",
          "mode": "ssg",
          "params": {
            "slug": "lolfucku",
          },
          "route_index": 0,
          "styles": [],
        },
      ],
      "version": 1,
    }
  `);
});
