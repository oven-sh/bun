import { describe, expect, test } from "bun:test";
import { emptyProcessMaxRSS, isASAN, isDebug, runFixtureMaxRSS, tempDir } from "harness";
import { join } from "node:path";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Each `enum E {}` block of a merged enum has its own symbol. An older symbol
  // links to the newest one, and all of them share one member table. Every way
  // to import the enum resolves to the newest symbol, so the linker gets the
  // inlinable values for that symbol only.
  itBundled("ts/EnumCrossModuleInliningMergedDeclarations", {
    files: {
      "/entry.ts": /* ts */ `
        import { drop_a, drop_b, c, d as dd } from './enums'
        import { ra } from './re-export'
        import { drop_b as sb } from './re-export-star'
        import * as ns from './enums'
        globalThis["captu" + "re"] = x => x;
        console.log(JSON.stringify([
          capture(drop_a.first),
          capture(drop_a.second),
          capture(drop_a.third),
          capture(drop_b.x),
          capture(drop_b.y),
          capture(c.p),
          capture(c.q),
          capture(c.r),
          capture(dd.m),
          capture(dd.n),
          capture(ra.first),
          capture(ra.third),
          capture(sb.x),
          capture(sb.y),
          capture(ns.drop_a.second),
          capture(ns.c.r),
        ]))
      `,
      "/re-export.ts": `export { drop_a as ra } from './enums'`,
      "/re-export-star.ts": `export * from './enums'`,
      "/enums.ts": /* ts */ `
        export enum drop_a { first = 1 }
        export enum drop_a { second = 'two' }
        export enum drop_a { third = first + 2 }

        enum drop_b { x = 10 }
        export { drop_b }
        enum drop_b { y = 20 }

        export enum c { p = 5 }
        export namespace c { export const q = 6 }
        export enum c { r = 7 }

        namespace d { export const m = 'ns' }
        enum d { n = 8 }
        export { d }
      `,
    },
    // Every use of drop_a and drop_b inlines, so no block of them stays.
    dce: true,
    minifySyntax: false, // intentionally disabled. enum inlining always happens
    onAfterBundle(api) {
      expect(api.captureFile("/out.js").map(x => x.replace(/\/\*.*\*\//g, "").trim())).toEqual([
        "1",
        '"two"',
        "3",
        "10",
        "20",
        "5",
        "c.q",
        "7",
        "d.m",
        "8",
        "1",
        "3",
        "10",
        "20",
        '"two"',
        "7",
      ]);
    },
    run: { stdout: '[1,"two",3,10,20,5,6,7,"ns",8,1,3,10,20,"two",7]' },
  });

  // The parser used to give the linker one full copy of the shared member table
  // per block, and the linker copied each of those again: n blocks cost n^2
  // entries. 8192 blocks of 1 member (100 KB of source) took 8.6 GB.
  test("merged enum blocks do not each get a copy of the shared member table", async () => {
    const blocks = 256;
    const membersPerBlock = 32;
    const count = blocks * membersPerBlock;
    let enums = "";
    for (let block = 0; block < blocks; block++) {
      const first = block * membersPerBlock;
      enums += `export enum E { M${first} = ${first}`;
      for (let i = first + 1; i < first + membersPerBlock; i++) enums += `, M${i}`;
      enums += " }\n";
    }
    const [head, middle, tail] = [0, count / 2, count - 1];
    using dir = tempDir("bundler-merged-enum", {
      "enums.ts": enums,
      "entry.ts": `import { E } from "./enums";\nconsole.log(E.M${head}, E.M${middle}, E.M${tail});\n`,
    });

    const fixture = /* js */ `
      const build = await Bun.build({ entrypoints: [${JSON.stringify(join(String(dir), "entry.ts"))}] });
      const code = await build.outputs[0].text();
      console.log(JSON.stringify({ log: code.split("\\n").find(line => line.startsWith("console.log(")) }));
    `;
    const [fixtureMaxRSS, baselineMaxRSS] = await Promise.all([
      // A member of the first, of a middle and of the last block still inlines.
      runFixtureMaxRSS(fixture, {
        log: `console.log(${head} /* M${head} */, ${middle} /* M${middle} */, ${tail} /* M${tail} */);`,
      }),
      emptyProcessMaxRSS(),
    ]);
    // Peak RSS over an empty process for this 51 KB input. Before the fix:
    // 220 MB in release, 320 MB in a debug ASAN build. After: 50 MB in debug.
    expect((fixtureMaxRSS - baselineMaxRSS) / 1024 / 1024).toBeLessThan(isASAN || isDebug ? 150 : 100);
  });
});
