import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { BundlerTestInput, expectBundled, itBundled, MappingSnapshot } from "./expectBundled";

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

// Source map checks that have to fail, and how each failure has to start. The
// quoted text does exist at each claimed generated position, which used to be
// the only thing `mappings` checked.
const rejected: Record<string, { opts: Partial<BundlerTestInput>; error: string }> = {
  // Generated line 8 also starts with `console`, but entry.ts:2 maps to line 7.
  WrongLine: {
    opts: withMapping(["entry.ts:2:'console'", "8:0:console"]),
    error: `entry.js.map: generated position of entry.ts:2:'console'\n\nExpected: "8:0:console"\nReceived: "7:0:console"`,
  },
  WrongText: {
    opts: withMapping(["entry.ts:2:'console'", "7:0:nope"]),
    error: `entry.js.map: generated position of entry.ts:2:'console'\n\nExpected: "7:0:nope"\nReceived: "7:0:cons"`,
  },
  // Generated line 1 is the `// greet.ts` comment; nothing in greet.ts:1 (also
  // a comment) is mapped at all.
  Unmapped: {
    opts: withMapping(["greet.ts:1:'greets'", "1:3:greet"]),
    error: `entry.js.map: generated position of greet.ts:1:'greets'\n\nExpected: "1:3:greet"\nReceived: "unmapped"`,
  },
  // runtimeFiles are written after bundling, so the map's sourcesContent no
  // longer matches greet.ts on disk.
  StaleSourcesContent: {
    opts: {
      snapshotSourceMap: { "entry.js.map": { files } },
      runtimeFiles: { "/greet.ts": `export function greet() {}` },
    },
    error: "entry.js.map: sourcesContent of ../greet.ts\n",
  },
  // Every external source map is checked for one generated position that maps
  // to two source positions. "AACA" adds a segment at the column of the last
  // segment on generated line 8 that points one source line further down.
  DuplicateMapping: {
    opts: {
      onAfterBundle(api) {
        const map = JSON.parse(api.readFile("out/entry.js.map"));
        map.mappings = map.mappings.replace(/;*$/, ",AACA");
        api.writeFile("out/entry.js.map", JSON.stringify(map));
      },
    },
    error: "Duplicate mapping in source-map for 8:24\n8:24 -> 3:24 [/entry.ts]\n8:24 -> 4:24 [/entry.ts]",
  },
};

describe("bundler", () => {
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

  // expectBundled's "test/bundler/" stack check never matches backslash paths, so
  // it throws before bundling anything on Windows (the itBundled case above is
  // silently dropped there for the same reason).
  describe.skipIf(isWindows)("rejects", () => {
    for (const [name, { opts, error }] of Object.entries(rejected)) {
      const id = `harness/SnapshotSourceMap${name}`;
      test(id, async () => {
        let message = "<expectBundled() passed>";
        try {
          // ignoreFilter: an ambient BUN_BUNDLER_TEST_FILTER must not turn these into no-ops.
          await expectBundled(id, { ...bundle, ...opts }, false, true);
        } catch (e: any) {
          // Expected/Received are colored when running in a terminal.
          message = Bun.stripANSI(e.message);
        }
        expect(message).toStartWith(error);
      });
    }
  });
});
