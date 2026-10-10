// A RegExp search that runs out of steps (BUN_JSC_regExpMatchLimit, 100,000,000 by default) or of
// backtracking memory (BUN_JSC_maxRegExpStackSize) is abandoned. It has no answer, so it throws a
// RangeError. It used to return what a failed match returns: false, null, -1, the unchanged string.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const limitError = "RangeError: Regular expression backtracking limit exceeded";
const overflowError = "RangeError: Maximum call stack size exceeded.";

// Runs `body` in a child with `env` added. The child prints the object `body` returns.
async function run(body: string, env: Record<string, string> = {}) {
  const code = `
    const outcome = run => {
      try {
        return { value: run() };
      } catch (e) {
        return { threw: e.name + ": " + e.message };
      }
    };
    console.log(JSON.stringify((() => { ${body} })()));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { result: stdout.trim() ? JSON.parse(stdout) : undefined, stderr, exitCode };
}

// One search per API. `subject` and `pattern` are expressions in the child.
const apis = {
  test: "new RegExp(pattern).test(subject)",
  exec: "new RegExp(pattern).exec(subject)",
  match: "subject.match(new RegExp(pattern))",
  matchAll: "[...subject.matchAll(new RegExp(pattern, 'g'))].length",
  search: "subject.search(new RegExp(pattern))",
  replace: "subject.replace(new RegExp(pattern), 'X')",
  split: "subject.split(new RegExp(pattern)).length",
};
const everyApi = (subject: string, pattern: string) => `
  const subject = ${subject};
  const pattern = ${pattern};
  return { ${Object.entries(apis)
    .map(([name, call]) => `${name}: outcome(() => ${call})`)
    .join(", ")} };
`;
const everyApiThrows = (error: string) => Object.fromEntries(Object.keys(apis).map(name => [name, { threw: error }]));

// 35 a's and a "c" match /(?:a|aa)+b|c/, at the "c". Finding that takes about 1e8 steps: the first
// alternative splits the a's into runs of one and two in every way, from each of 35 positions.
const stepPattern = JSON.stringify("(?:a|aa)+b|c");
const stepSubject = (count: number) => `Buffer.alloc(${count}, "a").toString() + "c"`;

// JIT code takes about 0.8 s to reach the default limit, so each API has its own child.
describe.concurrent("a search that runs out of steps at the default limit", () => {
  test.each(Object.entries(apis))("%s throws", async (name, call) => {
    const { result, stderr, exitCode } = await run(
      `const subject = ${stepSubject(35)}; const pattern = ${stepPattern}; return outcome(() => ${call});`,
    );
    expect({ result, stderr }).toEqual({ result: { threw: limitError }, stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("one step under the limit still matches", async () => {
    const { result, stderr, exitCode } = await run(
      `const subject = ${stepSubject(34)}; const pattern = ${stepPattern}; return outcome(() => new RegExp(pattern).exec(subject).index);`,
    );
    expect({ result, stderr }).toEqual({ result: { value: 34 }, stderr: "" });
    expect(exitCode).toBe(0);
  });
});

// The interpreter reaches the default limit only after minutes in a debug build, so these lower
// it. JIT code counts other steps than the interpreter (one per iteration of a group, where the
// interpreter counts each twice), so both run. At 10,000 steps the last input that matches has
// 15 a's with the JIT and 14 in the interpreter.
describe.concurrent("a search that runs out of steps at a lowered limit", () => {
  const engines = [
    ["with the RegExp JIT", {}],
    ["in the interpreter", { BUN_JSC_useRegExpJIT: "0" }],
  ] as const;

  test.each(engines)("every API throws %s", async (_, env) => {
    const { result, stderr, exitCode } = await run(everyApi(stepSubject(35), stepPattern), {
      BUN_JSC_regExpMatchLimit: "10000",
      ...env,
    });
    expect({ result, stderr }).toEqual({ result: everyApiThrows(limitError), stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.each(engines)("an input well under the limit matches %s", async (_, env) => {
    const { result, stderr, exitCode } = await run(everyApi(stepSubject(6), stepPattern), {
      BUN_JSC_regExpMatchLimit: "10000",
      ...env,
    });
    expect({ result, stderr }).toEqual({
      result: {
        test: { value: true },
        exec: { value: ["c"] },
        match: { value: ["c"] },
        matchAll: { value: 1 },
        search: { value: 6 },
        replace: { value: "aaaaaaX" },
        split: { value: 2 },
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // A search of this command filter takes about n * n / 2 steps with the JIT and n * n in the
  // interpreter. At 20,000 steps the last n that matches is 198 with the JIT and 140 in the
  // interpreter: 60 is under both, 600 is over both.
  test.each(engines)("a filter that is quadratic in its input throws past the limit %s", async (_, env) => {
    const { result, stderr, exitCode } = await run(
      `
        const command = n => "env" + Buffer.alloc(6 * n, " A=env").toString() + "\\nls\\ngit push";
        const filter = /(?:\\n|\\benv\\s+(?:\\w+=\\S*\\s+)*)git push/;
        return {
          under: outcome(() => [filter.test(command(60)), command(60).search(filter)]),
          over: outcome(() => filter.test(command(600))),
          search: outcome(() => command(600).search(filter)),
          replace: outcome(() => command(600).replace(filter, "X")),
        };
      `,
      { BUN_JSC_regExpMatchLimit: "20000", ...env },
    );
    expect({ result, stderr }).toEqual({
      result: {
        under: { value: [true, 366] },
        over: { threw: limitError },
        search: { threw: limitError },
        replace: { threw: limitError },
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // The answer of this search is "no match", and node gives it. A search that runs out of steps
  // cannot tell "no match" from a match it did not reach, so this one throws too. It takes as
  // many steps as the search of the command filter above.
  test.each(engines)("a search with no match throws past the limit too %s", async (_, env) => {
    const { result, stderr, exitCode } = await run(
      `
        const subject = n => Buffer.alloc(n, "a").toString();
        const regExp = /(?:a|b)+c/;
        return {
          under: outcome(() => [regExp.test(subject(60)), subject(60).search(regExp), subject(60).replace(regExp, "X").length]),
          over: outcome(() => regExp.test(subject(600))),
          search: outcome(() => subject(600).search(regExp)),
        };
      `,
      { BUN_JSC_regExpMatchLimit: "20000", ...env },
    );
    expect({ result, stderr }).toEqual({
      result: { under: { value: [false, -1, 60] }, over: { threw: limitError }, search: { threw: limitError } },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // JIT code has one entry for 8-bit and one for 16-bit strings, and a unicode RegExp runs its
  // search again when a match starts inside a surrogate pair.
  test.each(engines)("16-bit subjects and unicode RegExps throw at the limit %s", async (_, env) => {
    const { result, stderr, exitCode } = await run(
      `
        const subject = n => "\u{1F600}" + Buffer.alloc(n, "a").toString() + "c";
        const each = n => ["", "u", "v"].map(flags => outcome(() => new RegExp("(?:a|aa)+b|c", flags).exec(subject(n)).index));
        return { under: each(6), over: each(35), lastIndex: outcome(() => {
          const sticky = /(?:a|aa)+b|c/uy;
          sticky.lastIndex = 2;
          const threw = outcome(() => sticky.test(subject(35)));
          return [threw, sticky.lastIndex];
        }) };
      `,
      { BUN_JSC_regExpMatchLimit: "10000", ...env },
    );
    expect({ result, stderr }).toEqual({
      result: {
        under: [{ value: 8 }, { value: 8 }, { value: 8 }],
        over: [{ threw: limitError }, { threw: limitError }, { threw: limitError }],
        lastIndex: { value: [{ threw: limitError }, 2] },
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test.each(engines)("the limit is for one search, not for a /g operation %s", async (_, env) => {
    // 5,000 searches, each of them at least one step, are over 1,000 steps in total.
    const { result, stderr, exitCode } = await run(
      `
        const many = Buffer.alloc(10000, "ab").toString();
        return {
          replace: outcome(() => many.replace(/(?:a)+b/g, "").length),
          match: outcome(() => many.match(/(?:a)+b/g).length),
          split: outcome(() => many.split(/(?:a)+b/).length),
        };
      `,
      { BUN_JSC_regExpMatchLimit: "1000", ...env },
    );
    expect({ result, stderr }).toEqual({
      result: { replace: { value: 0 }, match: { value: 5000 }, split: { value: 5001 } },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("a /g operation throws when one of its searches is abandoned, with no partial result", async () => {
    const { result, stderr, exitCode } = await run(
      `
        const pattern = ${stepPattern};
        const late = "c" + ${stepSubject(35)};
        return {
          replace: outcome(() => late.replace(new RegExp(pattern, "g"), "X")),
          match: outcome(() => late.match(new RegExp(pattern, "g"))),
          split: outcome(() => late.split(new RegExp(pattern))),
        };
      `,
      { BUN_JSC_regExpMatchLimit: "10000" },
    );
    expect({ result, stderr }).toEqual({
      result: { replace: { threw: limitError }, match: { threw: limitError }, split: { threw: limitError } },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("a throw is not a failed match: lastIndex, the legacy statics and the RegExp are as before", async () => {
    const { result, stderr, exitCode } = await run(
      `
        const pattern = ${stepPattern};
        const subject = ${stepSubject(35)};
        /b(c)d/.exec("abcde");
        const sticky = new RegExp(pattern, "y");
        sticky.lastIndex = 3;
        const global = new RegExp(pattern, "g");
        global.lastIndex = 3;
        const reused = new RegExp(pattern);
        const iterator = subject.matchAll(new RegExp(pattern, "g"));
        return {
          sticky: [outcome(() => sticky.test(subject)), sticky.lastIndex],
          global: [outcome(() => global.exec(subject)), global.lastIndex],
          statics: [RegExp.lastMatch, RegExp.$1, RegExp.leftContext, RegExp.rightContext],
          reused: [outcome(() => reused.test(subject)), outcome(() => reused.test("aaac")), outcome(() => reused.test(subject))],
          matchAllNext: [outcome(() => iterator.next()), outcome(() => iterator.next())],
        };
      `,
      { BUN_JSC_regExpMatchLimit: "10000" },
    );
    expect({ result, stderr }).toEqual({
      result: {
        sticky: [{ threw: limitError }, 3],
        global: [{ threw: limitError }, 3],
        statics: ["bcd", "c", "a", "e"],
        reused: [{ threw: limitError }, { value: true }, { threw: limitError }],
        matchAllNext: [{ threw: limitError }, { threw: limitError }],
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // DFG code runs a search through its own operations. Each function is compiled on a subject that
  // matches, so that its RegExp node is live, and then gets a subject whose search is abandoned:
  // every call throws from the compiled code. Code that left for a lower tier at each of these
  // calls would be thrown away after 100 of them and compiled again. JSTests has the FTL and the
  // RegExp interpreter: regexp-abandoned-match-throws-in-compiled-code.js.
  test("compiled code runs an abandoned search and throws", async () => {
    const { result, stderr, exitCode } = await run(
      `
        const { noInline, numberOfDFGCompiles } = require("bun:jsc");
        const regExp = /(?:a|aa)+b|c/;
        const globalRegExp = /(?:a|aa)+b|c/g;
        const stickyRegExp = /(?:a|aa)+b|a+c/y;
        const sites = {
          test: s => regExp.test(s),
          testLiteral: s => /(?:a|aa)+b|c/.test(s),
          exec: s => regExp.exec(s)[0],
          execSticky: s => ((stickyRegExp.lastIndex = 1), stickyRegExp.exec(s)[0]),
          match: s => s.match(regExp)[0],
          matchGlobal: s => s.match(globalRegExp).length,
          matchAll: s => [...s.matchAll(globalRegExp)].length,
          search: s => s.search(regExp),
          replace: s => s.replace(regExp, "X"),
          replaceGlobal: s => s.replace(globalRegExp, ""),
          split: s => s.split(regExp).length,
        };
        const small = "aaac";
        const abandoned = Buffer.alloc(35, "a").toString() + "c";
        const result = {};
        for (const name in sites) {
          const site = sites[name];
          noInline(site);
          let warm;
          for (let i = 0; i < 1000000 && !numberOfDFGCompiles(site); i++) warm = site(small);
          const compiles = numberOfDFGCompiles(site);
          const seen = new Set();
          for (let i = 0; i < 110; i++) {
            const o = outcome(() => site(abandoned));
            seen.add(o.threw ?? "returned " + JSON.stringify(o.value));
          }
          result[name] = { warm, seen: [...seen], compiles: [compiles, numberOfDFGCompiles(site)], after: site(small) };
          if (name === "execSticky") result[name].lastIndexAfterThrow = (outcome(() => site(abandoned)), stickyRegExp.lastIndex);
        }
        return result;
      `,
      { BUN_JSC_regExpMatchLimit: "100", BUN_JSC_useConcurrentJIT: "0", BUN_JSC_useFTLJIT: "0" },
    );
    const threw = (value: unknown) => ({ warm: value, seen: [limitError], compiles: [1, 1], after: value });
    expect({ result, stderr }).toEqual({
      result: {
        test: threw(true),
        testLiteral: threw(true),
        exec: threw("c"),
        execSticky: { ...threw("aac"), lastIndexAfterThrow: 1 },
        match: threw("c"),
        matchGlobal: threw(1),
        matchAll: threw(1),
        search: threw(3),
        replace: threw("aaaX"),
        replaceGlobal: threw("aaa"),
        split: threw(2),
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // The DFG runs a constant RegExp on a constant string while it compiles, and puts the result in
  // place of the search. An abandoned search has no result: folded, these functions would return.
  // Their searches are statements: the DFG leaves compiled code before a call whose result is
  // used and that has never returned, so such a call never reaches a folded search.
  test("the DFG does not fold an abandoned search into a result", async () => {
    const { result, stderr, exitCode } = await run(
      `
        const { noInline, numberOfDFGCompiles } = require("bun:jsc");
        const regExp = /(?:a|aa)+b|c/;
        const deny = s => { if (regExp.test(s)) throw new TypeError("denied"); };
        for (let i = 0; i < 200; i++) deny("xyz");
        const sites = {
          test() { regExp.test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac"); return "returned"; },
          exec() { regExp.exec("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac"); return "returned"; },
          search() { "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac".search(regExp); return "returned"; },
          match() { "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac".match(regExp); return "returned"; },
          replace() { "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac".replace(regExp, "X"); return "returned"; },
          validator() { deny("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac"); return "returned"; },
        };
        const result = {};
        for (const name in sites) {
          const site = sites[name];
          noInline(site);
          const seen = new Set();
          // The DFG compiles each of these at its 166th call.
          for (let i = 0; i < 200; i++) {
            const o = outcome(site);
            seen.add(o.threw ?? "returned " + JSON.stringify(o.value));
          }
          result[name] = { seen: [...seen], compiled: numberOfDFGCompiles(site) > 0 };
        }
        return result;
      `,
      { BUN_JSC_regExpMatchLimit: "100", BUN_JSC_useConcurrentJIT: "0", BUN_JSC_useFTLJIT: "0" },
    );
    const threwEveryTime = { seen: [limitError], compiled: true };
    expect({ result, stderr }).toEqual({
      result: {
        test: threwEveryTime,
        exec: threwEveryTime,
        search: threwEveryTime,
        match: threwEveryTime,
        replace: threwEveryTime,
        validator: threwEveryTime,
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // Reading a legacy static runs the last successful search again. Near the end of the stack JIT
  // code has no room, so the interpreter runs it. At 2,000 steps the last input that matches has
  // 60 a's with the JIT and 42 in the interpreter: with 51, the search matches and is abandoned
  // when it runs again. That used to leave the getter with no result, and it crashed.
  test("a legacy static whose search is abandoned when it runs again throws", async () => {
    const { result, stderr, exitCode } = await run(
      `
        const anchored = /^(?:(?:a)*(?:a)*b|(a+)c)/;
        const subject = Buffer.alloc(51, "a").toString() + "c";
        // Reads the statics in the frame that is \`back\` frames above the deepest one the stack has
        // room for. There may be no room to call a function there, so the read is written in place.
        function atDepth(back) {
          let level = 0;
          let result;
          (function dive() {
            try {
              dive();
            } catch (e) {
              if (level !== 0 || !(e instanceof RangeError)) throw e;
            }
            if (level++ !== back) return;
            try {
              result = "value " + RegExp.lastMatch.length + ":" + RegExp.$1.length;
            } catch (e) {
              result = e.name + ": " + e.message;
            }
          })();
          return result;
        }
        // Compile the code for both kinds of search here, where the compiler has room.
        anchored.exec(subject);
        const seen = new Set();
        for (let back = 1; back <= 4096; back *= 2) {
          if (!anchored.test(subject)) return "the search did not match on a shallow stack";
          seen.add(atDepth(back));
        }
        return [...seen];
      `,
      // A small stack keeps the way down to its end short.
      { BUN_JSC_regExpMatchLimit: "2000", BUN_JSC_maxPerThreadStackUsage: "1048576" },
    );
    expect(stderr).toBe("");
    // How near the end of the stack JIT code still has room differs by build. Nearest the end the
    // interpreter may have no room either, which is the other way a search is abandoned.
    expect([limitError, overflowError, "value 52:51"]).toEqual(expect.arrayContaining(result));
    expect(result).toContain(limitError);
    expect(result).toContain("value 52:51");
    expect(exitCode).toBe(0);
  });

  test("an invalid pattern is still a SyntaxError", async () => {
    const { result, stderr, exitCode } = await run(
      `return [outcome(() => new RegExp("(")), outcome(() => new RegExp("(?:a|aa)+b|c").test("c"))];`,
      { BUN_JSC_regExpMatchLimit: "10000" },
    );
    expect({ result, stderr }).toEqual({
      result: [{ threw: "SyntaxError: Invalid regular expression: missing )" }, { value: true }],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("a search that runs out of backtracking memory", () => {
  // Today each iteration of a group that repeats keeps a context until the search ends. The
  // interpreter takes them from a pool of BUN_JSC_maxRegExpStackSize bytes.
  const pool = { BUN_JSC_useRegExpJIT: "0", BUN_JSC_maxRegExpStackSize: "1048576" };
  const memoryPattern = JSON.stringify("^(?:a|b)+$");
  const memorySubject = (count: number) => `Buffer.alloc(${count}, "a").toString()`;

  test("every API throws when 20,000 iterations do not fit in a 1 MB pool", async () => {
    const { result, stderr, exitCode } = await run(everyApi(memorySubject(20_000), memoryPattern), pool);
    expect({ result, stderr }).toEqual({ result: everyApiThrows(overflowError), stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("5,000 iterations fit in a 1 MB pool", async () => {
    const { result, stderr, exitCode } = await run(
      `
        const subject = ${memorySubject(5_000)};
        const pattern = ${memoryPattern};
        return [outcome(() => new RegExp(pattern).test(subject)), outcome(() => new RegExp(pattern).exec(subject)[0].length)];
      `,
      pool,
    );
    expect({ result, stderr }).toEqual({ result: [{ value: true }, { value: 5000 }], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // In /^(?:a|b)+$/ an iteration has one way to match. Here it has two, so the search needs its
  // contexts whatever the engine does for the first shape.
  test("a group whose iterations have a choice has the same limit", async () => {
    const { result, stderr, exitCode } = await run(
      `
        const choice = /^(?:a|ab)+$/;
        return [outcome(() => choice.test(${memorySubject(5_000)})), outcome(() => choice.test(${memorySubject(20_000)}))];
      `,
      pool,
    );
    expect({ result, stderr }).toEqual({ result: [{ value: true }, { threw: overflowError }], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // JIT code keeps the contexts on the machine stack. When they do not fit it starts the search
  // again in the interpreter, which then runs out of its pool.
  test("JIT code that runs out of stack, then the interpreter out of its pool, throws", async () => {
    const { result, stderr, exitCode } = await run(
      `
        const subject = ${memorySubject(2_000_000)};
        const pattern = ${memoryPattern};
        return [outcome(() => new RegExp(pattern).test(subject)), outcome(() => subject.replace(new RegExp(pattern), "X"))];
      `,
      { BUN_JSC_maxRegExpStackSize: "1048576" },
    );
    expect({ result, stderr }).toEqual({ result: [{ threw: overflowError }, { threw: overflowError }], stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("a pattern with no group keeps no contexts: 20,000,000 characters match", async () => {
    const { result, stderr, exitCode } = await run(
      `const subject = ${memorySubject(20_000_000)}; return outcome(() => /^[ab]+$/.test(subject));`,
      { BUN_JSC_maxRegExpStackSize: "1048576" },
    );
    expect({ result, stderr }).toEqual({ result: { value: true }, stderr: "" });
    expect(exitCode).toBe(0);
  });

  // Reading a legacy static runs the last successful search again. Near the end of the stack JIT
  // code has no room, so the interpreter runs it, and 1,000 contexts do not fit in a pool of 16 KB.
  // That used to leave the getter with no result, and it crashed.
  test("a legacy static whose search has no room when it runs again throws", async () => {
    const { result, stderr, exitCode } = await run(
      `
        const anchored = /^((?:a|b)+)c/;
        const subject = Buffer.alloc(1000, "a").toString() + "c";
        function atDepth(back) {
          let level = 0;
          let result;
          (function dive() {
            try {
              dive();
            } catch (e) {
              if (level !== 0 || !(e instanceof RangeError)) throw e;
            }
            if (level++ !== back) return;
            try {
              result = "value " + RegExp.lastMatch.length + ":" + RegExp.$1.length;
            } catch (e) {
              result = e.name + ": " + e.message;
            }
          })();
          return result;
        }
        anchored.exec(subject);
        const seen = new Set();
        for (let back = 0; back <= 4096; back = back ? back * 2 : 1) {
          if (!anchored.test(subject)) return "the search did not match on a shallow stack";
          seen.add(atDepth(back));
        }
        return [...seen];
      `,
      { BUN_JSC_maxRegExpStackSize: "16384", BUN_JSC_maxPerThreadStackUsage: "1048576" },
    );
    expect(stderr).toBe("");
    expect([overflowError, "value 1001:1000"]).toEqual(expect.arrayContaining(result));
    expect(result).toContain(overflowError);
    expect(result).toContain("value 1001:1000");
    expect(exitCode).toBe(0);
  });
});
