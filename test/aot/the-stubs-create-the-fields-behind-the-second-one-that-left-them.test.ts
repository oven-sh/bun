import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const numberOfFields = 24;
const numbers = Array.from({ length: numberOfFields }, (_, index) => index);

// Text that is evaluated gets hold of the object before it has a field, so nothing is proven about it where its fields are stored. It is made once: no store comes a second time.
const program = (head: string, tail: string) => `
globalThis.seen = (0, eval)("(function (object) { return object; })");
${head}
${numbers.map(number => `    this.field${number} = base + ${number};`).join("\n")}
${tail}
const made = new Made(1);
let sum = 0;
for (const name in made) sum += made[name];
console.log(sum);
`;

const files = {
  "a-function.cjs": program("function Made(base) {\n    seen(this);", "}"),
  "a-class.cjs": program("class Made {\n  constructor(base) {\n    seen(this);", "  }\n}"),
};

test.each(Object.keys(files))(
  "an object that is made once leaves the stubs for its first two fields: %s",
  async entry => {
    using dir = tempDir("aot-the-stubs-create-the-fields", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], String(dir));
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const counts = join(String(dir), "counts.txt");
    const ran = await run([executable], String(dir), { ...bunEnv, [runtimeEnvironment.countsPath]: counts });
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
      stdout: `${numbers.reduce((sum, number) => sum + 1 + number, 0)}\n`,
      stderr: "",
      exitCode: 0,
    });
    const storesThatLeft = readFileSync(counts, "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(([, what]) => what === "operation:operationAOTPutByIdAndCache")
      .reduce((sum, [times]) => sum + Number(times), 0);
    expect(storesThatLeft).toBeLessThan(numberOfFields / 4);
  },
  240_000,
);
