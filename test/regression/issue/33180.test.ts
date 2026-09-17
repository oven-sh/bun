// https://github.com/oven-sh/bun/issues/33180
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("require() of an ESM module the surrounding import graph is still fetching", async () => {
  using dir = tempDir("issue-33180-cycle", {
    "entry.mjs": `
      import "./starter.cjs";
      import a from "./a.cjs";
      import { lateViaESM } from "./b.mjs";
      console.log(JSON.stringify({ evaluations: globalThis.evaluations, late: a.late, lateViaESM: lateViaESM() }));
    `,
    "starter.cjs": `require("./a.cjs");`,
    "a.cjs": `
      globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
      exports.early = "early";
      require("./b.mjs");
      exports.late = "late";
    `,
    "b.mjs": `
      import a from "./a.cjs";
      export function lateViaESM() { return a.late; }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ evaluations: 1, late: "late", lateViaESM: "late" }) + "\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("consecutive require()s of several ESM siblings that are still transpiling", async () => {
  const files: Record<string, string> = {
    "entry.mjs": `
      import "./e1.mjs";
      import "./e2.mjs";
      import "./e3.mjs";
      import "./e4.mjs";
      import "./k.cjs";
      console.log("entry-done");
    `,
    "k.cjs": `
      const ids = [1, 2, 3, 4].map(i => require("./e" + i + ".mjs").id);
      console.log("required " + JSON.stringify(ids));
      module.exports = {};
    `,
  };
  for (let i = 1; i <= 4; i++) {
    let source = "";
    for (let j = 0; j < 500; j++) source += `export const v${j} = ${j};\n`;
    files[`e${i}.mjs`] = source + `export const id = ${i};\n`;
  }
  using dir = tempDir("issue-33180-siblings", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "required [1,2,3,4]\nentry-done\n",
    stderr: "",
    exitCode: 0,
  });
});
