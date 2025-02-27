import path from "node:path";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { SveltePlugin } from "bun-plugin-svelte";
import { promises as fs } from "node:fs";
import { Subprocess } from "bun";

const fixturePath = (...segs: string[]): string => path.join(__dirname, "fixtures", ...segs);

test("Bundling Svelte components", async () => {
  const outdir = tmpdirSync("bun-svelte-client-side");
  try {
    const result = await Bun.build({
      entrypoints: [fixturePath("app/index.ts")],
      outdir,
      sourcemap: "inline",
      minify: true,
      target: "browser",
      plugins: [SveltePlugin({ development: true })],
      // conditions: {
      //   "deve"
      // }
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
      env: bunEnv,
      cwd: fixturePath("app"),
      stderr: "inherit",
    });
    await Bun.sleep(50);
  });

  afterAll(() => {
    server?.kill();
  });

  it("serves the app", async () => {
    const response = await fetch("http://localhost:3000");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch("text/html");
  });
});
