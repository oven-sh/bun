import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Coverage for the WebKit 23d7f1dcef sync. Each case pins an observable difference between
// the old and the new JavaScriptCore. Each program runs in a child, because it depends on an
// option of the engine that is read when the process starts.

async function run(program: string, env: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", program],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

describe.concurrent("WebKit 23d7f1dcef upgrade", () => {
  // Each pattern comes in two forms that describe the same language. The second form adds a
  // prefix that matches the empty string only, or an alternative that no string can match. Both
  // keep the pattern out of the RegExp JIT, so with the JIT on the two forms run in the two
  // engines. They must give the same result, and every index and length must lie in the subject.
  const backreferences: [
    operation: string,
    flags: string,
    subject: string,
    plain: string,
    other: string,
    result: string,
  ][] = [
    [
      "split",
      "",
      "cqcIIxq",
      String.raw`(?:(?<x>qcIIx)|(?<x>c*(?:\k<x>*II)?))q`,
      String.raw`(?:Z?)+(?:(?<x>qcIIx)|(?<x>c*(?:\k<x>*II)?))q`,
      `["",undefined,"c","cIIx",undefined,"",""]`,
    ],
    [
      "match",
      "g",
      "q?cIIx",
      String.raw`^q\?|(?<=\?)(?:(?<x>a)|(?<x>c*(?:\k<x>*II)?))q|\?cII`,
      String.raw`^q\?|(?<=\?)(?:Z?)+(?:(?<x>a)|(?<x>c*(?:\k<x>*II)?))q|\?cII`,
      `["q?"]`,
    ],
    [
      "exec",
      "",
      "ccIx",
      String.raw`(?:(?<x>a)|(?<x>c*\k<x>*I?)+)(?!\w)`,
      String.raw`(?:Z?)+(?:(?<x>a)|(?<x>c*\k<x>*I?)+)(?!\w)`,
      `["",undefined,""]@4{x:""}`,
    ],
    [
      "exec",
      "",
      "aaBaacAc",
      String.raw`(?:(?<d>z)|(?<d>\w{1,3}?\k<d>*){2,}x)`,
      String.raw`(?:q*)+(?:(?<d>z)|(?<d>\w{1,3}?\k<d>*){2,}x)`,
      "null",
    ],
    [
      "exec",
      "",
      "cIx",
      String.raw`(?:(?<x>a)|(?<x>c*(?:\k<x>*I)?))>`,
      String.raw`(?:q*)+(?:(?<x>a)|(?<x>c*(?:\k<x>*I)?))>`,
      "null",
    ],
    [
      "exec",
      "",
      "zcIx",
      String.raw`(?:(?<x>a)|(?<x>c*(?:\k<x>*I)?))>`,
      String.raw`(?:(?<x>a)|(?<x>c*(?:\k<x>*I)?))>|z{2147483648}`,
      "null",
    ],
    [
      "match",
      "ug",
      "ccIIxa",
      String.raw`(?:(?<x>\w)|(?<x>\k<x>+(?:\k<x>?\k<x>?)*?c))x`,
      String.raw`(?:Z?)+(?:(?<x>\w)|(?<x>\k<x>+(?:\k<x>?\k<x>?)*?c))x`,
      `["Ix"]`,
    ],
    [
      "match",
      "ug",
      "q?cIIx",
      String.raw`(?:(?<x>\w)|(?<x>I+?\k<x>?(?:\k<x>*)*?))(?!\w)`,
      String.raw`(?:){2}(?:(?<x>\w)|(?<x>I+?\k<x>?(?:\k<x>*)*?))(?!\w)`,
      `["q","x"]`,
    ],
  ];

  const backreferenceProgram = `
    function describe(value, length) {
      if (value === null) return "null";
      if (value === undefined) return "undefined";
      if (typeof value === "string")
        return value.length > length ? "<out of range, length " + value.length + ">" : JSON.stringify(value);
      let result = "[" + Array.from(value, item => describe(item, length)).join(",") + "]";
      if (value.index !== undefined)
        result += "@" + (value.index > length ? "<out of range, " + value.index + ">" : value.index);
      if (value.groups)
        result += "{" + Object.keys(value.groups).sort().map(name => name + ":" + describe(value.groups[name], length)).join(",") + "}";
      return result;
    }
    for (const [operation, flags, subject, ...sources] of ${JSON.stringify(backreferences.map(entry => entry.slice(0, 5)))}) {
      for (const source of sources) {
        const regExp = new RegExp(source, flags);
        const result =
          operation === "match" ? subject.match(regExp) : operation === "split" ? subject.split(regExp, 100) : regExp.exec(subject);
        console.log(describe(result, subject.length));
      }
    }
  `;

  test.each([
    ["with the RegExp JIT", {}],
    ["without the RegExp JIT", { BUN_JSC_useRegExpJIT: "0" }],
  ])(
    "the interpreter and the JIT agree on a greedy backreference whose group is rewritten, %s",
    async (_, env: Record<string, string>) => {
      const { stdout, stderr, exitCode } = await run(backreferenceProgram, env);
      expect(stderr).toBe("");
      expect(stdout.split("\n")).toEqual(backreferences.flatMap(entry => [entry[5], entry[5]]));
      expect(exitCode).toBe(0);
    },
  );

  // maximumRegExpJITCodeSize is a limit on the code of one RegExp. An inlined RegExp#test is
  // emitted into the code of the function it is inlined into, and the limit counted that too.
  test("RegExp#test inlined behind more code than maximumRegExpJITCodeSize", async () => {
    const program = `
      import { numberOfDFGCompiles } from "bun:jsc";
      // 32 calls of a host function are more than 1024 bytes of code.
      const call = "Bun.nanoseconds();";
      const test = new Function("s", Buffer.alloc(32 * call.length, call).toString() + " return /^a/.test(s);");
      const wrong = [];
      // Until the DFG has compiled the function, and then long enough for that code to run.
      for (let runs = 0, compiled = 0; runs < 2_000_000 && compiled < 500 && wrong.length < 3; ++runs) {
        if (test("x") !== false) wrong.push('test("x")');
        if (test("a") !== true) wrong.push('test("a")');
        if (numberOfDFGCompiles(test)) ++compiled;
      }
      console.log(JSON.stringify({ wrong, compiled: numberOfDFGCompiles(test) > 0 }));
    `;
    const { stdout, stderr, exitCode } = await run(program, { BUN_JSC_maximumRegExpJITCodeSize: "1024" });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ wrong: [], compiled: true });
    expect(exitCode).toBe(0);
  });
});
