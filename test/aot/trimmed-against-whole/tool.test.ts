// ./run.ts builds programs with and without --trim and holds what they print against each other. It runs for hours, elsewhere. Here: it finds a difference that is there.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim, featureOf, model } from "../../bundler/compile-trim-features";
import { unsupported } from "../harness/compiler";
import { compareAll, jailOfThisMachine, type Program, type Result } from "./compare";
import { readRemovedFeatures } from "./removed-features";

test.skipIf(!canTrim || !!unsupported)(
  "a part that is left out of a program that uses it is found and named",
  async () => {
    using scratch = tempDir("trimmed-against-whole", {});
    const program: Program = {
      corpus: "control",
      name: "color",
      entry: "color.mjs",
      files: () => ({ "color.mjs": `console.log(Bun.color("red", "hex"));\n` }),
    };
    const results: Result[] = [];
    await compareAll(
      [program],
      {
        bun: bunExe(),
        scratch: join(String(scratch), "scratch"),
        kept: join(String(scratch), "kept"),
        model,
        jobs: 4,
        highestLoad: Infinity,
        leastMemory: 0,
        mostProcesses: 4000,
        jail: jailOfThisMachine(),
        buildSeconds: 180,
        runSeconds: 20,
        env: Object.fromEntries(
          ["PATH", "SystemRoot", "ASAN_OPTIONS", "LSAN_OPTIONS"].map(name => [name, bunEnv[name]]),
        ),
        buildFlags: [],
        findsFeature: true,
        wronglyLeftOut: [featureOf("Bun.color")],
      },
      result => results.push(result),
    );
    expect(results).toEqual([
      expect.objectContaining({
        verdict: "differs",
        features: [featureOf("Bun.color")],
        world: "the compiler can see every API this program uses",
      }),
    ]);
    expect(results[0].leftOut).toContain(featureOf("Bun.color"));
    const [{ why, whole, trimmed }] = results;
    if (why === "exit code 0 | 70") expect(trimmed?.stderr).toContain("--trim removed Bun.color from this executable");
    else
      expect({ why, stderr: trimmed?.stderr }).toEqual({
        why: "exit code 0 | 1",
        stderr: expect.stringContaining(`code: "ERR_FEATURE_REMOVED"`),
      });
    expect(whole).toEqual({ stdout: "#ff0000\n", stderr: "", exitCode: 0, signal: null });
  },
  300_000,
);

test("readRemovedFeatures returns undefined for a file without the list", () =>
  expect(readRemovedFeatures(import.meta.path)).toBeUndefined());

test.each([
  ["ELF", [0x7f, 0x45, 0x4c, 0x46]],
  ["Mach-O", [0xcf, 0xfa, 0xed, 0xfe]],
  ["PE", [0x4d, 0x5a]],
] as const)("readRemovedFeatures returns undefined for a truncated or corrupt %s file", (_, magic) => {
  using dir = tempDir("removed-features", {
    truncated: Buffer.from(magic),
    corrupt: Buffer.concat([Buffer.from(magic), Buffer.alloc(64 - magic.length, 0xff)]),
  });
  expect(readRemovedFeatures(join(String(dir), "truncated"))).toBeUndefined();
  expect(readRemovedFeatures(join(String(dir), "corrupt"))).toBeUndefined();
});

test.skipIf(!canTrim || !!unsupported)("readRemovedFeatures returns [] for an untrimmed Bun", () =>
  expect(readRemovedFeatures(bunExe())).toEqual([]),
);
