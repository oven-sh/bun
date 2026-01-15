import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/5344
// When one entry point re-exports from another entry point with code splitting,
// the bundler was producing duplicate export statements.
test("code splitting with re-exports between entry points should not produce duplicate exports", async () => {
  using dir = tempDir("issue-5344", {
    "entry-a.ts": `export { b } from "./entry-b.ts"; export function a() {}`,
    "entry-b.ts": `export function b() {}`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/entry-a.ts`, `${dir}/entry-b.ts`],
    outdir: `${dir}/dist`,
    splitting: true,
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(3); // entry-a.js, entry-b.js, chunk-*.js

  const entryB = result.outputs.find(o => o.path.endsWith("entry-b.js"));
  expect(entryB).toBeDefined();

  const entryBContent = await entryB!.text();

  const exportMatches = entryBContent.match(/^export\s*\{/gm);
  expect(exportMatches?.length).toBe(1);

  const entryAUrl = Bun.pathToFileURL(`${dir}/dist/entry-a.js`);
  const entryBUrl = Bun.pathToFileURL(`${dir}/dist/entry-b.js`);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { a, b } from "${entryAUrl}";
      import { b as b2 } from "${entryBUrl}";
      console.log(typeof a, typeof b, b === b2);
    `,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("function function true");
  expect(exitCode).toBe(0);
});
