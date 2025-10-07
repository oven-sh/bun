import { Subprocess } from "bun";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { promises as fs, statSync } from "node:fs";
import path from "node:path";

const fixturePath = (...segs: string[]): string => path.join(import.meta.dirname, "fixtures", ...segs);

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
  test("Bundling Svelte components", async () => {
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
  });

  describe("Using Svelte components in Bun's dev server", () => {
    let server: Subprocess;

    beforeAll(async () => {
      server = Bun.spawn([bunExe(), "./index.html"], {
        env: {
          ...bunEnv,
          NODE_ENV: "development",
        },
        cwd: fixturePath("app"),
        stdio: ["ignore", "inherit", "inherit"],
      });
      await Bun.sleep(500);
    });

    afterAll(() => {
      server?.kill();
    });

    it("serves the app", async () => {
      const response = await fetch("http://localhost:3000");
      await console.log(await response.text());
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch("text/html");
    });
  });
});
