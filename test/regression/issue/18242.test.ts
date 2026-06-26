import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Bun.build works multiple times after FileSystemRouter is created", async () => {
  using dir = tempDir("issue-18242", {
    "pages/index.ts": `console.log("Hello via Bun!");`,
    "build.ts": `
import path from "path";

const PAGES_DIR = path.resolve(process.cwd(), "pages");

const srcRouter = new Bun.FileSystemRouter({
  dir: PAGES_DIR,
  style: "nextjs",
});

const entrypoints = Object.values(srcRouter.routes);

const result1 = await Bun.build({
  entrypoints,
  outdir: "dist/browser",
});

const result2 = await Bun.build({
  entrypoints,
  outdir: "dist/bun",
  target: "bun",
});

const result3 = await Bun.build({
  entrypoints,
  outdir: "dist/third",
});

console.log(JSON.stringify({
  build1: result1.success,
  build2: result2.success,
  build3: result3.success,
  build2Logs: result2.logs.map(String),
  build3Logs: result3.logs.map(String),
}));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());

  expect(result.build1).toBe(true);
  expect(result.build2).toBe(true);
  expect(result.build3).toBe(true);
  expect(result.build2Logs).toEqual([]);
  expect(result.build3Logs).toEqual([]);
  expect(exitCode).toBe(0);
});
