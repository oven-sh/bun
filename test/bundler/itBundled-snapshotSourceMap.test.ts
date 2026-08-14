import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows } from "harness";
import { BundlerTestInput, itBundled, MappingSnapshot } from "./expectBundled";

// Every case in this file bundles the same two files. out/entry.js is:
//
//   1 | // greet.ts
//   2 | function greet(name) {
//   3 |   return "hello " + name;
//   4 | }
//   5 |
//   6 | // entry.ts
//   7 | console.log(greet("world"));
//   8 | console.log(greet("bun"));
const bundle = {
  files: {
    "/entry.ts": /* ts */ `
      import { greet } from "./greet";
      console.log(greet("world"));
      console.log(greet("bun"));
    `,
    "/greet.ts": /* ts */ `
      // greets someone
      export function greet(name: string) {
        return "hello " + name;
      }
    `,
  },
  outdir: "/out",
  sourceMap: "external",
} satisfies BundlerTestInput;
const files = ["../greet.ts", "../entry.ts"];

function withMapping(mapping: MappingSnapshot): Partial<BundlerTestInput> {
  return { snapshotSourceMap: { "entry.js.map": { files, mappings: [mapping] } } };
}

// Snapshots that disagree with the emitted source map, and what their failure
// has to say. The quoted text does exist at each claimed generated position,
// which used to be the only thing `mappings` checked.
const rejected: Record<string, { opts: Partial<BundlerTestInput>; output: string[] }> = {
  // Generated line 8 also starts with `console`, but entry.ts:2 maps to line 7.
  WrongLine: {
    opts: withMapping(["entry.ts:2:'console'", "8:0:console"]),
    output: [
      "entry.js.map: generated position of entry.ts:2:'console'",
      'Expected: "8:0:console"',
      'Received: "7:0:console"',
    ],
  },
  WrongText: {
    opts: withMapping(["entry.ts:2:'console'", "7:0:nope"]),
    output: [
      "entry.js.map: generated position of entry.ts:2:'console'",
      'Expected: "7:0:nope"',
      'Received: "7:0:cons"',
    ],
  },
  // Generated line 1 is the `// greet.ts` comment; nothing in greet.ts:1 (also
  // a comment) is mapped at all.
  Unmapped: {
    opts: withMapping(["greet.ts:1:'greets'", "1:3:greet"]),
    output: [
      "entry.js.map: generated position of greet.ts:1:'greets'",
      'Expected: "1:3:greet"',
      'Received: "unmapped"',
    ],
  },
  // runtimeFiles are written after bundling, so the map's sourcesContent no
  // longer matches greet.ts on disk.
  StaleSourcesContent: {
    opts: {
      snapshotSourceMap: { "entry.js.map": { files } },
      runtimeFiles: { "/greet.ts": `export function greet() {}` },
    },
    output: ["entry.js.map: sourcesContent of ../greet.ts"],
  },
};
const CHILD_ENV = "BUN_BUNDLER_TEST_REJECTED_SNAPSHOTS";

describe("bundler", () => {
  if (process.env[CHILD_ENV]) {
    // Spawned by the test below: only register the cases that have to fail.
    for (const [name, { opts }] of Object.entries(rejected)) {
      itBundled(`harness/SnapshotSourceMap${name}`, { ...bundle, ...opts });
    }
    return;
  }

  itBundled("harness/SnapshotSourceMap", {
    ...bundle,
    snapshotSourceMap: {
      "entry.js.map": {
        files,
        mappings: [
          ["greet.ts:2:'greet'", "2:9:greet"],
          ["greet.ts:3:'return'", "3:2:return"],
          ["entry.ts:2:'console'", "7:0:console"],
          ["entry.ts:3:'\"bun\"'", '8:18:"bun"'],
        ],
      },
    },
  });

  // itBundled() registers nothing on Windows yet: expectBundled's "test/bundler/"
  // stack check never matches backslash paths, so the child would have nothing to fail.
  test.skipIf(isWindows)(
    "snapshotSourceMap rejects snapshots the emitted source map disagrees with",
    async () => {
      const env: Record<string, string | undefined> = { ...bunEnv, [CHILD_ENV]: "1" };
      // bunEnv spreads process.env; an ambient filter would keep the child from registering its cases.
      delete env.BUN_BUNDLER_TEST_FILTER;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--timeout=60000", import.meta.path],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const output = stdout + stderr;

      for (const [name, { output: lines }] of Object.entries(rejected)) {
        expect(output).toContain(`(fail) bundler > harness/SnapshotSourceMap${name}`);
        for (const line of lines) expect(output).toContain(line);
      }
      expect(output).toContain(" 0 pass\n");
      expect(output).toContain(` ${Object.keys(rejected).length} fail\n`);
      expect(exitCode).toBe(1);
    },
    // A debug build spends a few seconds just starting the child and importing the harness in it.
    isDebug ? 60_000 : undefined,
  );
});
