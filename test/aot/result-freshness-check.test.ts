// A built-in whose signature says `fresh` promises that each call allocates its result and keeps no other reference to it.
// --aot-testing=CheckResultFreshnessAtRunTime checks every such result after the call. Builds with assertions always check.
// The check cannot prove that a result is fresh. It stops the program on any of four findings that are impossible for a fresh object.
// Each case below injects a fault that marks one built-in as fresh although it returns an existing object.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const check = "CheckResultFreshnessAtRunTime";
const readPrototype = `const kept = { held: 7 };
const holder = Object.create(kept);
function take(from) { return Reflect.getPrototypeOf(from); }
`;

const cases: [name: string, builtin: string, source: string, printed: string, finding: string][] = [
  [
    "the receiver",
    "Array.prototype.reverse",
    `function flip(list) { return list.reverse()[0]; }
console.log(flip([1, 2, 3]));
`,
    "3\n",
    "the result is the receiver",
  ],
  [
    "the first argument",
    "Object.freeze",
    `function seal(box) { return Object.freeze(box).held; }
console.log(seal({ held: 7 }));
`,
    "7\n",
    "the result is the first argument",
  ],
  [
    "an object that an earlier call returned",
    "Reflect.getPrototypeOf",
    `${readPrototype}console.log(take(holder).held + take(holder).held);
`,
    "14\n",
    "an earlier call that is also declared fresh returned the same object",
  ],
  [
    "an object that survived a collection",
    "Reflect.getPrototypeOf",
    `${readPrototype}Bun.gc(true);
console.log(take(holder).held);
`,
    "7\n",
    "the result survived a collection that ended before the call",
  ],
];

describe.skipIf(!!unsupported)("the result freshness check", () => {
  for (const [name, builtin, source, printed, finding] of cases)
    test(`stops a built-in that is marked fresh and returns ${name}`, () =>
      slot(async () => {
        using dir = tempDir("aot-result-freshness", { "main.js": source });
        const folder = String(dir);
        const run = async (outfile: string, testing: string) => {
          const built = await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              ...withoutDebugInformation,
              `--aot-testing=${testing}`,
              "./main.js",
              "--outfile",
              outfile,
            ],
            folder,
            env,
          );
          expect(built.exitCode).toBe(0);
          return spawned([join(folder, isWindows ? `${outfile}.exe` : outfile)], folder, env);
        };
        const checked = await run("checked", check);
        expect({ stdout: checked.stdout, exitCode: checked.exitCode }).toEqual({ stdout: printed, exitCode: 0 });
        const faulty = await run("faulty", `UnderstateEffects:Builtin/${builtin}/FreshnessOfResult,${check}`);
        expect(faulty.stderr).toContain(`  ${builtin} is declared to return a fresh object, but ${finding}\n`);
        expect(faulty.exitCode).not.toBe(0);
      }));

  test("accepts fresh results across many collections", () =>
    slot(async () => {
      using dir = tempDir("aot-result-freshness", {
        "main.js": `function work(round) {
  const base = [round, round + 1, round + 2];
  const keys = Object.keys({ a: round, b: 2 });
  const entries = Object.entries({ a: round });
  const words = "a,b,c".split(",");
  const copy = Array.from(new Set(base));
  const bytes = new Uint8Array(4).slice(1);
  return base.concat(copy).length + keys.length + entries.length + words.length + bytes.length;
}
let total = 0;
for (let round = 0; round < 100000; round++) total += work(round);
console.log(total);
`,
      });
      const folder = String(dir);
      const built = await spawned(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          ...withoutDebugInformation,
          `--aot-testing=${check}`,
          "./main.js",
          "--outfile",
          "checked",
        ],
        folder,
        env,
      );
      expect(built.exitCode).toBe(0);
      const checked = await spawned([join(folder, isWindows ? "checked.exe" : "checked")], folder, env);
      expect({ stdout: checked.stdout, exitCode: checked.exitCode }).toEqual({ stdout: "1500000\n", exitCode: 0 });
    }));
});
