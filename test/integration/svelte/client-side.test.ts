import { Subprocess } from "bun";
import { bunEnv, bunExe, isASAN, isDebug, tmpdirSync } from "harness";
import { promises as fs, statSync } from "node:fs";
import path from "node:path";

const fixturePath = (...segs: string[]): string => path.join(import.meta.dirname, "fixtures", ...segs);

// Running the real Svelte compiler (in-process Bun.build and via the spawned
// dev server) takes ~8-11s under debug+ASAN; the workload can't be shrunk.
const svelteCompileTimeout = isDebug || isASAN ? 30_000 : undefined;

beforeAll(async () => {
  const pluginDir = path.resolve(import.meta.dirname, "..", "..", "..", "packages", "bun-plugin-svelte");
  expect(statSync(pluginDir).isDirectory()).toBeTrue();
  Bun.spawnSync([bunExe(), "install"], {
    cwd: pluginDir,
    stdio: ["ignore", "ignore", "ignore"],
    env: bunEnv,
  });
});

describe("generating client-side code", () => {
  test(
    "Bundling Svelte components",
    async () => {
      const outdir = tmpdirSync("bun-svelte-client-side");
      const { SveltePlugin } = await import("bun-plugin-svelte");
      try {
        const result = await Bun.build({
          entrypoints: [fixturePath("app/index.ts")],
          outdir,
          sourcemap: "inline",
          minify: true,
          target: "browser",
          plugins: [SveltePlugin({ development: true })],
        });
        expect(result.success).toBeTrue();

        const entrypoint = result.outputs.find(o => o.kind === "entry-point");
        expect(entrypoint).toBeDefined();
      } finally {
        await fs.rm(outdir, { force: true, recursive: true });
      }
    },
    svelteCompileTimeout,
  );

  describe("Using Svelte components in Bun's dev server", () => {
    let server: Subprocess<"ignore", "pipe", "inherit">;
    let baseUrl: string;

    beforeAll(async () => {
      server = Bun.spawn({
        cmd: [bunExe(), "./index.html", "--port=0", "--hostname=127.0.0.1"],
        env: {
          ...bunEnv,
          NODE_ENV: "development",
        },
        cwd: fixturePath("app"),
        stdio: ["ignore", "pipe", "inherit"],
      });

      const decoder = new TextDecoder();
      let text = "";
      for await (const chunk of server.stdout) {
        text += decoder.decode(chunk, { stream: true });
        const match = text.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) {
          baseUrl = match[0];
          break;
        }
      }

      if (!baseUrl) {
        throw new Error("dev server did not print a URL.\nstdout: " + text);
      }
    });

    afterAll(() => {
      server?.kill();
    });

    it(
      "serves the app",
      async () => {
        const response = await fetch(baseUrl);
        const body = await response.text();
        expect(body).toContain("<title>Svelte App</title>");
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toMatch("text/html");
      },
      svelteCompileTimeout,
    );
  });
});
