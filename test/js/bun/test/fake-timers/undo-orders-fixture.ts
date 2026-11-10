// Runs every order of up to `depth` calls that put something on globalThis.setTimeout or take it off, then each order in `more`.
// After each call, and after each of four ways to undo everything, the global must not have a spy that was restored or the value
// of a stub that was removed: not as its value, not in its accessor, and not as what a call of a live spy on it ends in.
// Prints { orders, retracted }. `retracted` has the first orders that break this, each with what the global had after each call.
import { jest, vi } from "bun:test";

const depth = Number(process.argv[2]);
const more: string[][] = JSON.parse(process.argv[3] ?? "[]");
const calls = [
  "spyOn",
  "spyGet",
  "spySet",
  "restoreFirst",
  "restoreLast",
  "stub",
  "stubMock",
  "unstub",
  "assign",
  "fake",
  "real",
];
// "spies" restores the spies in the order they were made, "seips" in the other order.
const ends = [
  ["real", "spies", "unstub"],
  ["real", "seips", "unstub"],
  ["spies", "unstub", "real"],
  ["unstub", "seips", "real"],
];

const real = globalThis.setTimeout;
const realDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setTimeout")!;
const clear = globalThis.clearTimeout;
type Spy = ReturnType<typeof jest.spyOn>;
type Made = { kind: "spy" | "stub" | "assigned"; isLive: boolean };
// The functions of this file that the last call of a spy reached.
let reached: Function[] = [];

function play(order: string[], end: string[] = []): string[] {
  const made = new Map<unknown, Made>();
  const spies: Spy[] = [];

  const name = (value: unknown): string => {
    if (value === real) return "real";
    if (value === undefined) return "undefined";
    const it = made.get(value);
    if (it?.kind === "spy") return it.isLive ? `spy over ${endOfCall(value as Function)}` : "RESTORED SPY";
    if (it) return it.kind === "stub" && !it.isLive ? "REMOVED STUB" : it.kind;
    if (typeof value !== "function") return String(value);
    if (Object.hasOwn(value, "clock")) return "fake";
    // A spy of a method that a getter returns is installed as a bound getter that returns the spy.
    const returned = value.name.startsWith("bound ") ? value() : undefined;
    return made.get(returned)?.kind === "spy" ? `getter of ${name(returned)}` : "uninstalled fake";
  };
  const endOfCall = (spy: Function): string => {
    reached = [];
    const timers = jest.isFakeTimers() ? jest.getTimerCount() : 0;
    let timer: unknown;
    try {
      timer = spy(() => {}, 2 ** 30);
    } catch {
      return "a function that throws";
    }
    if (reached.length) return name(reached[0]);
    if (jest.isFakeTimers() && jest.getTimerCount() > timers) {
      jest.clearAllTimers();
      return "fake";
    }
    if (timer && typeof timer === "object") {
      clear(timer as Timer);
      return "real";
    }
    // A restored spy of jest.spyOn() returns undefined.
    return "RESTORED SPY";
  };
  const state = () => {
    const own = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
    if (!own) return "MISSING";
    if (!("get" in own)) return name(own.value);
    const halves = [own.get, own.set].map(half => (made.get(half)?.isLive ? "spy" : name(half)));
    return `accessor of ${halves.join(" and ")} that gives ${name(globalThis.setTimeout)}`;
  };

  const functionThatSaysWhenCalled = () => {
    const fn = () => void reached.push(fn);
    return fn;
  };
  const spyOn = (access?: "get" | "set") => {
    let spy: Spy;
    try {
      spy = access ? jest.spyOn(globalThis, "setTimeout", access as any) : jest.spyOn(globalThis, "setTimeout");
    } catch {
      // spyOn() refuses some properties, such as the getter of a setter-only accessor.
      return;
    }
    // spyOn() of a global that has a mock function returns that function.
    if (made.has(spy)) return;
    spies.push(spy);
    made.set(spy, { kind: "spy", isLive: true });
  };
  const restore = (spy: Spy | undefined) => {
    if (!spy || !made.get(spy)!.isLive) return;
    spy.mockRestore();
    made.get(spy)!.isLive = false;
  };
  const stub = (value: Function) => {
    vi.stubGlobal("setTimeout", value);
    made.set(value, { kind: "stub", isLive: true });
  };
  const run = (call: string) => {
    if (call === "spyOn") spyOn();
    else if (call === "spyGet") spyOn("get");
    else if (call === "spySet") spyOn("set");
    else if (call === "restoreFirst") restore(spies.find(spy => made.get(spy)!.isLive));
    else if (call === "restoreLast") restore(spies.findLast(spy => made.get(spy)!.isLive));
    else if (call === "spies") spies.forEach(restore);
    else if (call === "seips") spies.toReversed().forEach(restore);
    else if (call === "stub") stub(functionThatSaysWhenCalled());
    else if (call === "stubMock") stub(vi.fn(functionThatSaysWhenCalled()));
    else if (call === "unstub") {
      vi.unstubAllGlobals();
      for (const it of made.values()) if (it.kind === "stub") it.isLive = false;
    } else if (call === "assign") {
      const assigned = functionThatSaysWhenCalled();
      // An accessor with no setter, or one whose setter is a spy, keeps what it has.
      const isAssigned =
        Reflect.set(globalThis, "setTimeout", assigned) &&
        Object.getOwnPropertyDescriptor(globalThis, "setTimeout")!.value === assigned;
      if (isAssigned) made.set(assigned, { kind: "assigned", isLive: true });
    } else if (call === "fake") jest.useFakeTimers();
    else if (call === "real") jest.useRealTimers();
    else throw new Error(`unknown call ${call}`);
  };

  const states: string[] = [];
  for (const call of order) {
    run(call);
    if (!end.length) states.push(state());
  }
  if (!end.length) return states;
  end.forEach(run);
  states.push(state());
  // The next useFakeTimers() takes an uninstalled fake off the global, as the end of a test file does.
  jest.useFakeTimers();
  jest.useRealTimers();
  states.push(state());
  return states;
}

function reset() {
  jest.useRealTimers();
  jest.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, "setTimeout", realDescriptor);
}

let orders = 0;
const retracted: string[] = [];
function check(order: string[]) {
  orders++;
  const states = play(order);
  reset();
  for (const end of ends) {
    states.push(`[${end.join(", ")}]`, ...play(order, end));
    reset();
  }
  if (retracted.length < 5 && states.some(state => /RESTORED SPY|REMOVED STUB|MISSING/.test(state))) {
    retracted.push(`${order.join(", ")}: ${states.join(" > ")}`);
  }
}
function extend(order: string[]) {
  if (order.length) check(order);
  if (order.length < depth) for (const call of calls) extend([...order, call]);
}
extend([]);
more.forEach(check);
console.log(JSON.stringify({ orders, retracted }));
