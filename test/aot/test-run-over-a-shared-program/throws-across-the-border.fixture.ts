// A throw leaves frames of the shared program and of the test file in turn. Handlers, cleanups and what the frames have kept are on both sides.
import { expect } from "bun:test";
import { test } from "../harness/declare";
import * as lib from "./throws";
const text = (e: unknown) => (e instanceof Error ? e.name + ": " + e.message + ((e as any).code ? " #" + (e as any).code : "") : typeof e + " " + String(e));
const rows: string[] = [];
const say = (label: string, run: () => unknown) => {
  let said: string;
  try {
    said = "answers " + JSON.stringify(run());
  } catch (e) {
    said = "throws " + text(e);
  }
  rows.push(label + " | " + said);
};
const names = (e: unknown) =>
  String((e as Error).stack)
    .split("\n")
    .slice(1)
    .map(line => /at (?:async )?(?:new )?([\w.<>]+)/.exec(line)?.[1] ?? "?")
    .filter(name => !/^(say|<anonymous>|\?)$/.test(name))
    .slice(0, 14)
    .join(" ");
function ownFails(message: string): never {
  throw new lib.Failure(message);
}
function ownCalls<T>(f: () => T): T {
  const r = f();
  return r;
}
function ownCleansUp<T>(log: string[], f: () => T): T {
  try {
    const r = f();
    return r;
  } finally {
    log.push("own cleanup");
  }
}
class OwnFailure extends lib.Failure {
  constructor(message: string) {
    super(message, 11);
    this.name = "OwnFailure";
  }
}
test("throws across the border", async () => {
  say("they throw, I catch", () => lib.fail("a"));
  say("I throw through them", () => lib.calls(() => ownFails("b")));
  say("through eight of their frames", () => lib.deep(8, () => ownFails("c")));
  say("through their tail call", () => lib.tailCalls(() => ownFails("d")));
  say("they catch what I throw", () => lib.catches(() => ownFails("e")));
  say("they catch what they throw under me", () => lib.catches(() => ownCalls(() => lib.fail("f"))));
  for (const value of [1, "text", null, undefined, { a: 1 }, Symbol.for("s"), 10n, false])
    say("a value that is no error: " + String(typeof value), () => lib.calls(() => lib.failWith(value)));
  say("cleanups in order", () => {
    const log: string[] = [];
    try {
      ownCleansUp(log, () => lib.cleansUp(log, () => ownCleansUp(log, () => lib.cleansUp(log, () => lib.fail("g")))));
    } catch (e) {
      log.push("caught " + text(e));
    }
    return log;
  });
  say("rethrown on the way", () => {
    const log: string[] = [];
    try {
      lib.rethrows(log, () => ownCalls(() => lib.rethrows(log, () => ownFails("h"))));
    } catch (e) {
      log.push("caught " + text(e));
    }
    return log;
  });
  say("the same object arrives", () => {
    const thrown = new OwnFailure("i");
    try {
      lib.deep(3, () => lib.rethrows([], () => { throw thrown; }));
    } catch (e) {
      return e === thrown;
    }
  });
  say("replaced on the way", () => lib.replaces(() => ownFails("j")));
  say("a cleanup that answers", () => lib.overrides(() => ownFails("k")));
  say("in their constructor", () => new lib.Runs(() => ownFails("l")));
  say("in their constructor's parent", () => new lib.RunsToo(() => ownFails("m")));
  say("their constructor runs", () => new lib.RunsToo(() => {}).ran);
  say("my subclass of their error", () => { throw new OwnFailure("n"); });
  say("their subclass of their error", () => { throw new lib.DeeperFailure("o"); });
  say("a generator of theirs", () => {
    const log: string[] = [];
    const steps = lib.steps(log, () => ownFails("p"));
    log.push(String(steps.next().value));
    try {
      steps.next();
    } catch (e) {
      log.push("caught " + text(e));
    }
    log.push(JSON.stringify(steps.next()));
    return log;
  });
  say("through a built-in", () => lib.overList([1, 2, 3], x => (x === 2 ? ownFails("q") : x)));
  say("they catch through a built-in", () => lib.catches(() => [1].map(() => lib.overList([1], () => ownFails("r")))));
  say("a getter of theirs", () => lib.holder.failing);
  say("a setter of theirs", () => { lib.holder.failing = 5; });
  say("a read of null in their code", () => lib.readsNull({}));
  say("what their frame kept", () => lib.keeps([1, 2, 3, 4, 5, 6], () => ownCalls(() => lib.deep(4, () => ownFails("s")))));
  say("what my frame kept", () => {
    let a = rows.length + 1, b = a + 1, c = b + 1, d = c + 1, e = d + 1;
    try {
      lib.deep(5, () => lib.fail("t"));
    } catch {
      return [a, b, c, d, e];
    }
  });
  say("an overflow in their code", () => {
    try {
      lib.overflows(0);
    } catch (e) {
      return (e as Error).name;
    }
  });
  say("an overflow through both", () => {
    const both = (n: number): number => lib.calls(() => both(n + 1)) + 1;
    try {
      both(0);
    } catch (e) {
      return (e as Error).name;
    }
  });
  say("after the overflows", () => lib.catches(() => ownFails("x")));
  say("many in turn", () => {
    let caught = 0;
    for (let i = 0; i < 20000; i++) {
      try {
        if (i % 3) lib.deep(i % 5, () => ownFails("y"));
        else lib.fail("z");
      } catch {
        caught++;
      }
    }
    return caught;
  });
  say("the frames of their throw", () => { try { lib.deep(2, () => ownCalls(() => lib.fail("1"))); } catch (e) { return names(e); } });
  say("the frames of my throw", () => { try { lib.deep(2, () => ownCalls(() => ownFails("2"))); } catch (e) { return names(e); } });
  say("the frames of my subclass", () => { try { lib.calls(() => { throw new OwnFailure("3"); }); } catch (e) { return names(e); } });
  say("the frames of their subclass", () => { try { lib.calls(() => ownCalls(() => { throw new lib.DeeperFailure("4"); })); } catch (e) { return names(e); } });
  say("the frames in their constructor", () => { try { new lib.RunsToo(() => ownFails("5")); } catch (e) { return names(e); } });
  const wait = async (label: string, run: () => Promise<unknown>) => {
    let said: string;
    try {
      said = "answers " + JSON.stringify(await run());
    } catch (e) {
      said = "throws " + text(e);
    }
    rows.push(label + " | " + said);
  };
  await wait("their async function rejects", () => lib.later(() => ownFails("6")));
  await wait("their async function catches", () => lib.laterCatches(() => ownFails("7")));
  await wait("their async function catches mine", () => lib.laterCatches(async () => { await null; ownFails("8"); }));
  await wait("mine catches theirs", async () => { try { await lib.later(() => lib.fail("9")); } catch (e) { return "caught " + text(e); } });
  await wait("a rejection through both", () => lib.later(() => ownCalls(() => lib.calls(() => lib.fail("10")))));
  expect(rows.length).toBeGreaterThan(40);
  expect(rows).toMatchSnapshot();
});
