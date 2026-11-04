import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function buildAndRun(files: Record<string, string>, entrypoints: string[]) {
  using dir = tempDir("bundler-many-chunks", files);
  const result = await Bun.build({
    entrypoints: entrypoints.map(entry => join(String(dir), entry)),
    root: String(dir),
    outdir: join(String(dir), "out"),
    splitting: true,
    target: "bun",
    format: "esm",
  });
  expect(result.logs).toEqual([]);
  expect(result.success).toBe(true);
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "out", "main.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("every chunk finds the next one in a ring of many chunks", async () => {
  const count = 500;
  const files: Record<string, string> = {
    "main.js": `
      let current = await import("./e0.js");
      let sum = 0;
      for (let step = 0; step < ${count}; step++) {
        sum += current.value;
        current = await current.next();
      }
      console.log(sum, current.value);
    `,
  };
  for (let index = 0; index < count; index++) {
    files[`e${index}.js`] = `
      export const value = ${index};
      export const next = () => import("./e${(index + 1) % count}.js");
    `;
  }
  const entrypoints = ["main.js", ...Array.from({ length: count }, (_, index) => `e${index}.js`)];
  expect(await buildAndRun(files, entrypoints)).toEqual({
    stdout: `${(count * (count - 1)) / 2} 0\n`,
    stderr: "",
    exitCode: 0,
  });
});

test("a chunk may name other chunks more often than there are chunks", async () => {
  const references = 200;
  const loaders = Array.from({ length: references }, () => `() => import("./other.js")`).join(",\n");
  const files = {
    "main.js": `
      const loaders = [${loaders}];
      let sum = 0;
      for (const load of loaders) sum += (await load()).value;
      console.log(sum);
    `,
    "other.js": `export const value = 2;`,
  };
  expect(await buildAndRun(files, ["main.js", "other.js"])).toEqual({
    stdout: `${2 * references}\n`,
    stderr: "",
    exitCode: 0,
  });
});
