import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, normalizeBunSnapshot } from "harness";
import { join } from "path";
import { tempDirWithBakeDeps } from "./bake-harness";

test("bake production build generates manifest with SSR and SSG pages", async () => {
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

  expect(manifest).toMatchInlineSnapshot(`
    {
      "assets": [
        "/_bun/xrj8f476.js",
        "/_bun/7r2ttg7d.js",
        "/_bun/kq6mn4cb.js",
        "/_bun/rzwb0r0y.js",
        "/_bun/fy7ntj6j.js",
        "/_bun/wvqsb8zz.js",
        "/_bun/n8n6m1t3.js",
        "/_bun/7kj4nre7.js",
        "/_bun/xrj8f476.js.map",
        "/_bun/7r2ttg7d.js.map",
        "/_bun/kq6mn4cb.js.map",
        "/_bun/rzwb0r0y.js.map",
        "/_bun/fy7ntj6j.js.map",
        "/_bun/wvqsb8zz.js.map",
        "/_bun/n8n6m1t3.js.map",
        "/_bun/7kj4nre7.js.map",
      ],
      "router_types": [
        {
          "server_entrypoint": "./xrj8f476.js",
        },
      ],
      "routes": [
        {
          "entrypoint": "/_bun/7r2ttg7d.js",
          "mode": "ssg",
          "route": "/index",
          "route_type": 0,
          "styles": [],
        },
        {
          "client_entrypoint": "/_bun/7r2ttg7d.js",
          "mode": "ssr",
          "modules": [
            "./rzwb0r0y.js",
          ],
          "route": "/blog/[slug]",
          "route_type": 0,
          "styles": [],
        },
        {
          "client_entrypoint": "/_bun/7r2ttg7d.js",
          "mode": "ssr",
          "modules": [
            "./fy7ntj6j.js",
          ],
          "route": "/about",
          "route_type": 0,
          "styles": [],
        },
      ],
      "version": "0.0.1",
    }
  `);
}, 30000);

test("bake production build generates manifest with multiple SSG pages under the same route", async () => {
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

  expect(manifest).toMatchInlineSnapshot(`
    {
      "assets": [
        "/_bun/xrj8f476.js",
        "/_bun/7r2ttg7d.js",
        "/_bun/q3vvqn7h.js",
        "/_bun/wvqsb8zz.js",
        "/_bun/n8n6m1t3.js",
        "/_bun/7kj4nre7.js",
        "/_bun/xrj8f476.js.map",
        "/_bun/7r2ttg7d.js.map",
        "/_bun/q3vvqn7h.js.map",
        "/_bun/wvqsb8zz.js.map",
        "/_bun/n8n6m1t3.js.map",
        "/_bun/7kj4nre7.js.map",
      ],
      "router_types": [
        {
          "server_entrypoint": "./xrj8f476.js",
        },
      ],
      "routes": [
        {
          "entrypoint": "/_bun/7r2ttg7d.js",
          "mode": "ssg",
          "params": {
            "slug": "lmao",
          },
          "route": "/blog/[slug]",
          "route_type": 0,
          "styles": [],
        },
        {
          "entrypoint": "/_bun/7r2ttg7d.js",
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
}, 30000);
