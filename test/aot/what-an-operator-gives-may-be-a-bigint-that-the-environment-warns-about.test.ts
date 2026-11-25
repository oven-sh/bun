// process.env warns (DEP0104, under --pending-deprecation) about a stored value that is no string, number or boolean. What prints the
// warning is in an executable only where such a value may be stored, and what an operator gives is judged by the operator and by its
// written operands. Each of these gives a bigint, so the warning must be there. Each program is built alone: one store that brings the
// printer in would hide all the others.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const givesBigInt = {
  "a sum of two values that nobody knows": "big + big",
  "a product": "big * big",
  "a power": "big ** big",
  "a negation": "-big",
  "a complement": "~big",
  "an increment": "++big",
  "a decrement": "--big",
  "the value in front of an increment": "big++",
  "a sum with a written bigint": "big + 1n",
  "a product with a written bigint": "big * 1n",
  "the bits of a written bigint": "big | 1n",
  "a shift by a written bigint": "big << 1n",
};

const env = { ...bunEnv, BUN_OPTIONS: "--pending-deprecation" };

async function outcomeOf(cmd: string[], cwd: string) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, warns: stderr.includes("DEP0104"), exitCode };
}

for (const [what, expression] of Object.entries(givesBigInt))
  test.concurrent(`${what} is stored and the environment warns`, async () => {
    using dir = tempDir("aot-bigint-into-the-environment", {
      "main.js": `let big = BigInt(JSON.parse("2"));\nprocess.env.MADE_UP = ${expression};\nconsole.log(process.env.MADE_UP);\n`,
    });
    const folder = String(dir);
    const executable = join(folder, "main" + (isWindows ? ".exe" : ""));
    await using built = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", executable],
      cwd: folder,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [said, builtWith] = await Promise.all([built.stderr.text(), built.exited]);
    expect({ errors: said.split("\n").filter(line => line.startsWith("error")), exitCode: builtWith }).toEqual({
      errors: [],
      exitCode: 0,
    });
    const plain = await outcomeOf([bunExe(), "main.js"], folder);
    expect(plain).toMatchObject({ warns: true, exitCode: 0 });
    expect(await outcomeOf([executable], folder)).toEqual(plain);
  });
