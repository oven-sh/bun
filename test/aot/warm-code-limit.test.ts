// Of a very large program only the hottest code is treated as warm (--aot-limit=MaxWarmCodeValues). The code beyond the limit is
// compiled as cold code, but it is expected to run: a sequence of machine code that several places share costs a call and a
// return each time it runs, so none is taken from code that is cold by the limit alone.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

const program = `
function one(o) { return [o.a, o.b, o.c, o.d, o.e, o.f, o.g, o.h].join("-") + "1"; }
function two(o) { return [o.a, o.b, o.c, o.d, o.e, o.f, o.g, o.h].join("-") + "2"; }
function three(o) { return [o.a, o.b, o.c, o.d, o.e, o.f, o.g, o.h].join("-") + "3"; }
let n = 0;
for (let i = 0; i < Number(process.argv[2] ?? 3); i++) {
  const o = { a: i, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
  n += one(o).length + two(o).length + three(o).length;
  for (let k = 0; k < 3; k++) n += k * i;
}
console.log(n);
`;

async function build(folder: string, name: string, flags: string[]) {
  const report = join(folder, name + ".json");
  const executable = join(folder, isWindows ? name + ".exe" : name);
  built(
    await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-report=" + report,
        ...flags,
        "./main.mjs",
        "--outfile",
        executable,
      ],
      folder,
      bunEnv,
    ),
  );
  const { stdout, exitCode } = await spawned([executable], folder, bunEnv);
  return { bytesShared: JSON.parse(readFileSync(report, "utf8")).statistics.BytesOutlined as number, stdout, exitCode };
}

// TODO: a build in which everything is cold shares no machine code, so there is nothing to hold the limited build against.
test.todo(
  "no machine code is shared out of code that is cold by the limit alone",
  async () => {
    using dir = tempDir("aot-warm-code-limit", { "main.mjs": program });
    const folder = String(dir);
    const usual = await build(folder, "usual", []);
    const limited = await build(folder, "limited", ["--aot-limit=MaxWarmCodeValues:1"]);
    const cold = await build(folder, "cold", ["--aot-heat=EverythingIsCold"]);
    expect(limited).toMatchObject({ stdout: usual.stdout, exitCode: 0 });
    expect(cold).toMatchObject({ stdout: usual.stdout, exitCode: 0 });
    expect(limited.bytesShared).toBeLessThan(cold.bytesShared);
  },
  240_000,
);
