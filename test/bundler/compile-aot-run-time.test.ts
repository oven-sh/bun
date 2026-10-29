// What an executable built with --aot does at run time, seen from outside: what it prints to stderr, a profile, dumps of the engine.
// The programs share one build.
import { describe, expect } from "bun:test";
import { bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { run as runCommand } from "../aot/harness/run";
import { separatePrograms, startsAtAnyEntryPoint } from "../aot/harness/separate-programs";
import { test } from "../aot/supported";

const rows = (literal: (i: number) => string) => `
  import { heapStats } from "bun:jsc";
  const rows = [
  ${Array.from(
    { length: 3000 },
    (_, i) => `  { kind: ${JSON.stringify(literal(i))}, list: [${JSON.stringify(literal(i))}, "x${i % 7}y"] },`,
  ).join("\n")}
  ];
  Bun.gc(true);
  const strings = heapStats().objectTypeCounts.string;
  console.log(JSON.stringify([rows.length, rows[0].kind, rows[2999].kind, rows[2999].list.join(), new Set(rows.map(row => row.kind)).size]));
  console.log(strings);
`;
const repeated = () => "a literal that is repeated";
const distinct = (i: number) => "a literal that is not repeated " + i;

const uncaught = (method: string) =>
  `[1].${method}(function callback() { throw new Error("thrown in the callback"); });`;

const files = {
  "spies/entry.ts": `
    const lazy = await import("./lazy"), user = await import("./user");
    const { spyOn } = await new Function("return import('bun:test')")();
    for (const name of ["helper", "table", "box"]) {
      let said: string;
      try { spyOn(lazy, name); said = "replaced"; } catch (e: any) { said = e.constructor.name; }
      console.log(name, said, user.fromUser());
    }
    const own = { method() { return 1; } };
    spyOn(own, "method").mockImplementation(() => 2);
    console.log(own.method());
  `,
  "spies/lazy.ts": `
    export const table = { kept: 1, other: 2 };
    export class Box { v = 1; w = 2.5; get() { return this.v + this.w; } }
    export const box = new Box();
    export function helper(n: number) { return n * 2; }
    export function read() { return table.kept + ":" + table.other + ":" + box.get() + ":" + helper(2); }
  `,
  "spies/user.ts": `
    import { read, table, box, helper } from "./lazy";
    export function fromUser() { return read() + " | " + table.kept + ":" + box.get() + ":" + helper(3); }
  `,
  "uncaught-in-for-each.ts": uncaught("forEach"),
  "uncaught-in-map.ts": uncaught("map"),
  "regexps.ts": `
    const build = (word: string) => new RegExp(["(\\\\w+)@", "(\\\\w+)\\\\.", word].join(""));
    const words = process.env.WORDS!.split(",");
    const usedOnce = build(words[0]!), usedOften = build(words[1]!), usedOnLongText = build(words[2]!);
    let found = usedOnce.exec("to foo@bar.cold")!.slice(1).join();
    for (let i = 0; i < 1000; i++) found = usedOften.exec("to foo@bar.hot")!.slice(1).join() + i;
    console.log(found, usedOnLongText.exec(Buffer.alloc(20000, "x ").toString() + "foo@bar.long")!.slice(1).join());
    console.log(new Function("a", "return a + 1")(1));
  `,
  "profiled.ts": `
    function busy(rounds: number, seed: number) {
      let total = seed;
      for (let round = 0; round < rounds; round++) {
        total += JSON.stringify({ round }).length;
        for (let i = 1; i < 3000; i++) total += Math.sin(i + total) * Math.pow(i, 0.37) + Math.log(i) + Math.atan2(i, total);
      }
      return total;
    }
    const chosen = [busy, Math.max][process.argv.length > 99 ? 1 : 0]!;
    console.log(chosen(2000, 1) + chosen(2000, 2) !== 0);
  `,
  "constructors.ts": `
    class ImplicitBase { kind() { return "base"; } }
    class ImplicitDerived extends ImplicitBase { kind() { return "derived of " + super.kind(); } }
    class ImplicitTwice extends ImplicitDerived {}
    class WithFields { a = 1; #b = 2; sum() { return this.a + this.#b; } }
    class DerivedWithFields extends WithFields { c = 3; total() { return this.sum() + this.c; } }
    class Takes { constructor(public x: number, public y = 5) {} }
    class Forwards extends Takes {}
    class ImplicitError extends Error {}
    class ImplicitArray extends Array<number> {}
    class ImplicitMap extends Map<string, number> {}
    const made = (() => class extends Takes {})();
    const out: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      out.length = 0;
      out.push(new ImplicitBase().kind(), new ImplicitDerived().kind(), new ImplicitTwice().kind());
      out.push(new WithFields().sum(), new DerivedWithFields().total());
      out.push(new Forwards(1).x, new Forwards(1).y, new Forwards(1, 2).y, new made(7).x);
      const error = new ImplicitError("message");
      out.push(error.message, error instanceof ImplicitError, error instanceof Error, error.name);
      out.push(new ImplicitArray(3).length, ImplicitArray.of(1, 2).length, new ImplicitMap([["k", 1]]).get("k"));
      out.push(ImplicitBase.name, ImplicitDerived.length, made.name);
      out.push(Reflect.construct(ImplicitDerived, [], ImplicitTwice) instanceof ImplicitTwice);
      for (const C of [ImplicitBase, ImplicitDerived, Forwards]) {
        try {
          (C as unknown as () => void)();
          out.push("called");
        } catch (e) {
          out.push((e as Error).constructor.name);
        }
      }
    }
    console.log(out.join());
  `,
  "repeated-literals.ts": rows(repeated),
  "distinct-literals.ts": rows(distinct),
};

describe.concurrent.skipIf(!startsAtAnyEntryPoint)("--aot at run time", () => {
  const { folder, build, start } = separatePrograms(
    "compile-aot-run-time",
    files,
    Object.keys(files).filter(file => !/^spies\/(lazy|user)/.test(file)),
  );

  test("exports of compiled modules cannot be spied on", async () => {
    expect(await start("spies/entry.ts")).toEqual({
      stdout: ["helper", "table", "box"].map(name => name + " TypeError 1:2:3.5:4 | 1:3.5:6\n").join("") + "2\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    ["forEach", "uncaught-in-for-each.ts"],
    ["map", "uncaught-in-map.ts"],
  ])("an uncaught error from the callback of %s is reported", async (method, entry) => {
    const { stdout, stderr, exitCode } = await start(entry);
    expect({ stdout, firstLines: stderr.split("\n").slice(0, 3), exitCode }).toEqual({
      stdout: "",
      firstLines: [
        "error: thrown in the callback",
        expect.stringMatching(new RegExp(String.raw`^ +at callback \(.*${entry.replace(".", "\\.")}:\d+:\d+\)$`)),
        expect.stringMatching(new RegExp(`^ +at ${method} `)),
      ],
      exitCode: 1,
    });
  });

  test("run-time RegExps are never compiled, however hot: they run on a flat program", async () => {
    // The build says of the one place that makes them that its pattern is not known.
    expect((await build()).stderr).toMatch(/warn: TS100058: .*\n +at .*regexps\.ts:2:/);
    const { stdout, stderr, exitCode } = await start("regexps.ts", {
      BUN_JSC_dumpCompiledRegExpPatterns: "1",
      WORDS: "c[o]ld,h[o]t,l[o]ng",
    });
    expect(stdout).toBe("foo,bar999 foo,bar\n2\n");
    const lines = stderr.split(/\r?\n/);
    const whatHappenedTo = (word: string) =>
      lines.flatMap((line, i) =>
        line.endsWith(`${word}/"`) ? [line.slice(0, line.indexOf(" this regular expression")), lines[i + 1]] : [],
      );
    expect({
      usedOnce: whatHappenedTo("c[o]ld"),
      usedOften: whatHappenedTo("h[o]t"),
      usedOnLongText: whatHappenedTo("l[o]ng"),
    }).toEqual({
      usedOnce: ["Can't JIT", "Runs on a flat program"],
      usedOften: ["Can't JIT", "Runs on a flat program"],
      usedOnLongText: ["Can't JIT", "Runs on a flat program"],
    });
    expect(exitCode).toBe(0);
  });

  test("--cpu-prof attributes native time to the calling function", async () => {
    const { stdout, stderr, exitCode } = await start("profiled.ts", {
      BUN_OPTIONS: `--cpu-prof --cpu-prof-dir=${folder} --cpu-prof-name=entry.cpuprofile`,
    });
    expect({ stdout, stderr }).toEqual({ stdout: "true\n", stderr: "" });
    expect(exitCode).toBe(0);

    const hits: Record<string, number> = {};
    for (const node of (await Bun.file(join(folder, "entry.cpuprofile")).json()).nodes)
      hits[node.callFrame.functionName] = (hits[node.callFrame.functionName] ?? 0) + node.hitCount;
    // How many samples a run gets depends on the machine and on its timer.
    const samples = Object.values(hits).reduce((sum, count) => sum + count, 0);
    expect({ hits, isSeen: hits.busy! > samples / 20 }).toEqual({ hits, isSeen: true });
    expect(hits.busy).toBeGreaterThan(3 * (hits.stringify ?? 0));
  });

  test("implicit constructors need no bytecode", async () => {
    const { stdout, stderr, exitCode } = await start("constructors.ts", { BUN_JSC_dumpGeneratedBytecodes: "1" });
    expect(stdout.split("\n").filter(line => !line.includes("#") && line.includes(","))).toEqual([
      "base,derived of base,derived of base,3,6,1,5,2,7,message,true,true,Error,3,2,1,ImplicitBase,0,,true,TypeError,TypeError,TypeError",
    ]);
    expect((stdout + stderr).match(/^\S*(Implicit|WithFields|Forwards)\S*#\w+:\[/gm)).toBeNull();
    expect(exitCode).toBe(0);
  });

  test.each([
    ["equal literals share a string", "repeated-literals.ts", repeated, 1],
    ["different literals do not", "distinct-literals.ts", distinct, 3000],
  ] as const)("%s", async (_, entry, literal, kinds) => {
    const { stdout, stderr, exitCode } = await start(entry);
    const [first, second] = stdout.trim().split("\n");
    expect([JSON.parse(first), stderr, exitCode]).toEqual([
      [3000, literal(0), literal(2999), literal(2999) + ",x3y", kinds],
      "",
      0,
    ]);
    if (kinds === 1) expect(Number(second)).toBeLessThan(3000);
    else expect(Number(second)).toBeGreaterThanOrEqual(3000);
  });
});

test("compiles RegExps with the u and v flags", async () => {
  using dir = tempDir("compile-aot-regexps", {
    "one.ts": `console.log(/o+ne/.test("one"));`,
    "some.ts": `console.log([/a+b/.test("aab"), /\\p{L}+x/u.test("\\xe9x"), /^.$/u.test("\\u{1f600}"), /[\\p{L}--[a-c]]y/v.test("dy")].join());`,
  });
  async function numberOfRegExps(entry: string, expectedStdout: string) {
    const outfile = join(String(dir), entry.replace(".ts", ""));
    const { stderr: stderrOfBuild, exitCode: exitCodeOfBuild } = await runCommand(
      [bunExe(), "build", "--compile", "--aot", "--explain=statistics", entry, "--outfile", outfile],
      String(dir),
    );
    expect(stderrOfBuild).not.toContain("error");
    expect(exitCodeOfBuild).toBe(0);
    const { stdout, exitCode } = await runCommand([outfile]);
    expect(stdout).toBe(expectedStdout);
    expect(exitCode).toBe(0);
    return Number(stderrOfBuild.match(/^RegExpsCompiled (\d+)$/m)?.[1]);
  }
  const [one, some] = await Promise.all([
    numberOfRegExps("one.ts", "true\n"),
    numberOfRegExps("some.ts", "true,true,true,true\n"),
  ]);
  expect(one).toBeGreaterThanOrEqual(1);
  expect(some).toBe(one + 3);
});
