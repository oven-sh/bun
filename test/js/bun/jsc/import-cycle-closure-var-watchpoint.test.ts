import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// In an import cycle a module's hoisted functions are callable before the
// module's own code runs. b.mjs calls two of a.mjs's functions that early, so
// JSC links them before it links the code that declares the variables they
// write. The DFG then treated those variables as constants: reads froze at a
// stale value and the writes disappeared.
const files = {
  "a.mjs": `
    import "./b.mjs";

    export let lexical = 0;
    export var hoisted = 0;

    export function addLexical(value) {
      if (value) lexical += value;
      return lexical;
    }
    export function readLexical() {
      return lexical;
    }
    export function addLexicalThreeTimes() {
      let result;
      for (let i = 0; i < 3; ++i) result = addLexical(1);
      return result;
    }
    export function addHoisted(value) {
      if (value) hoisted += value;
      return hoisted;
    }
    export function readHoisted() {
      return hoisted;
    }
  `,
  "b.mjs": `
    import { addLexical, addHoisted } from "./a.mjs";

    // a.mjs is not evaluated yet: "lexical" is in its TDZ, "hoisted" is undefined.
    let early = [];
    try {
      addLexical(0);
    } catch (e) {
      early.push(e.name);
    }
    early.push(String(addHoisted(0)));
    globalThis.early = early.join(",");
  `,
  "main.mjs": `
    import * as namespace from "./a.mjs";
    import { lexical, hoisted, addLexical, readLexical, addLexicalThreeTimes, addHoisted, readHoisted } from "./a.mjs";

    const failures = [];
    function check(what, round, actual, expected) {
      if (actual !== expected && failures.length < 5) failures.push(what + " in round " + round + ": got " + actual + ", want " + expected);
    }

    for (let i = 0; i < 20000; ++i) {
      const base = i * 4;

      check("addLexical(1)", i, addLexical(1), base + 1);
      check("readLexical()", i, readLexical(), base + 1);
      check("lexical", i, lexical, base + 1);
      check("namespace.lexical", i, namespace.lexical, base + 1);

      check("addLexicalThreeTimes()", i, addLexicalThreeTimes(), base + 4);
      check("readLexical()", i, readLexical(), base + 4);
      check("lexical", i, lexical, base + 4);
      check("namespace.lexical", i, namespace.lexical, base + 4);

      check("addHoisted(2)", i, addHoisted(2), i * 2 + 2);
      check("readHoisted()", i, readHoisted(), i * 2 + 2);
      check("hoisted", i, hoisted, i * 2 + 2);
      check("namespace.hoisted", i, namespace.hoisted, i * 2 + 2);
    }

    console.log(JSON.stringify({ early: globalThis.early, lexical, hoisted, failures }));
  `,
};

test.concurrent.each([
  ["default JIT options", {}],
  // Compiles on the main thread, so the tier-up happens at a fixed call count.
  ["useConcurrentJIT=0", { BUN_JSC_useConcurrentJIT: "0" }],
])(
  "a variable written by a function that an import cycle linked before its module ran keeps every write (%s)",
  async (_, env) => {
    using dir = tempDir("import-cycle-closure-var", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: { ...bunEnv, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      early: "ReferenceError,undefined",
      lexical: 80000,
      hoisted: 40000,
      failures: [],
    });
    expect(exitCode).toBe(0);
  },
);
