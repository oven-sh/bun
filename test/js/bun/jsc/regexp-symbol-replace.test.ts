// RegExp.prototype[Symbol.replace] called directly used to take the generic path of
// JavaScriptCore always: one call of "exec" and one match array per match, about 7 times
// slower than String.prototype.replace with the same RegExp. It now takes the fast path of
// String.prototype.replace when nothing can observe the difference (oven-sh/WebKit#682).
// The node-ported builtins call it through the RegExpPrototypeSymbolReplace primordial
// (util.inspect, console.group, node:repl, node:tls).
//
// The fixture runs in a child process, because it ends with a replaced RegExp.prototype.exec.
// That turns the fast path off for the rest of a process.
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

let report: any;

beforeAll(async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "regexp-symbol-replace-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  report = JSON.parse(stdout);
  expect(exitCode).toBe(0);
});

describe("RegExp.prototype[Symbol.replace] called directly", () => {
  test("takes the same path as String.prototype.replace", () => {
    expect(report.path).toEqual({
      sameAsStringReplace: true,
      uncurriedSameAsStringReplace: true,
      // A RegExp with an own property still takes the generic path.
      genericPath: "3,3,3",
    });
  });

  test("gives the result and the lastIndex of the generic path", () => {
    expect(report.matrix.mismatches).toEqual([]);
    expect(report.matrix.compared).toBeGreaterThan(9000);
  });

  test("converts each argument once, the string first", () => {
    expect(report.conversions).toEqual({
      results: ["a-b-", "a-b-"],
      log: ["string", "replaceValue", "string", "replaceValue"],
    });
  });

  test("observes what the conversion of an argument does to the RegExp", () => {
    expect(report.sideEffects).toEqual({
      ownExecDuringString: { result: "aaa", calls: 1 },
      ownExecDuringReplaceValue: { result: "aaa", calls: 1, conversions: 1 },
      lastIndexDuringReplaceValue: { result: "aba", log: ["replaceValue", "lastIndex"], lastIndex: 2 },
    });
  });

  test("takes the generic path for a receiver that is not a primordial RegExp", () => {
    expect(report.receivers).toEqual({
      subclass: ["bbb", 4],
      plainObject: "a[b]c",
      primitive: "throw:TypeError:RegExp.prototype.@@replace requires that |this| be an Object",
      frozenGlobal: "throw:TypeError:Attempted to assign to readonly property.",
      frozenSingle: "value:baa",
      otherRealm: "he[ll]o wor[l]d",
    });
  });

  test("observes a replaced RegExp.prototype.exec", () => {
    expect(report.replacedExec).toEqual({
      during: "bbb",
      callsDuring: 4,
      after: "ccc",
      callsAfter: 4,
      never: "aaa",
    });
  });
});
