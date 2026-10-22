import { absent, assertNumber, assertPresent, assertTrue, fail, Guard, impossible, isText, nil, nothing } from "./library.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function afterFail(): string {
  fail("first");
  return "the statement after the call ran";
}

function resultOfFail(): unknown {
  const result = fail("second");
  return [typeof result, result];
}

function narrowedByFail(n: number | undefined): number {
  if (n === undefined) fail("third");
  return n + 1;
}

function everyPathFails(n: number): number {
  if (n > 0) return n;
  fail("fourth");
}

function inASwitch(kind: "a" | "b"): number {
  switch (kind) {
    case "a":
      return 1;
    default:
      fail("fifth");
  }
}

function assigned(flag: boolean): number {
  let n: number;
  if (flag) n = 1;
  else fail("sixth");
  return n + 1;
}

function asserted(v: unknown): unknown {
  assertNumber(v);
  return [v + 1, v * 2, typeof v];
}

function present(p: { x: number } | null | undefined): number {
  assertPresent(p);
  return p.x;
}

function condition(v: string | number): number {
  assertTrue(typeof v === "string");
  return v.length;
}

function guarded(v: unknown): unknown {
  return isText(v) ? [v.length, v + "!"] : "no text";
}

function afterAMethod(): string {
  const guard: Guard = new Guard();
  guard.stop();
  return "the statement after the method ran";
}

function checkedByAMethod(v: unknown): unknown {
  const guard: Guard = new Guard();
  guard.check(v);
  return [v.length, v + "!"];
}

function thisIsReady(): unknown {
  const guard = new Guard();
  return guard.ready() ? [guard.level, guard.level + 1] : "not ready";
}

attempt("after a call", afterFail);
attempt("its result", resultOfFail);
attempt("narrowed", () => [narrowedByFail(1), narrowedByFail(undefined)]);
attempt("every path", () => [everyPathFails(1), everyPathFails(0), everyPathFails(0) + 1]);
attempt("in a switch", () => [inASwitch("a"), inASwitch("b")]);
attempt("a variable that was never assigned", () => [assigned(true), assigned(false)]);
attempt("an assertion for numbers", () => [asserted(1), asserted("1"), asserted(null), asserted([2])]);
attempt("an assertion that something is there", () => present({ x: 1 }));
attempt("an assertion that something is there, null", () => present(null));
attempt("an assertion of a condition", () => [condition("ab"), condition(5)]);
attempt("a guard", () => [guarded("ab"), guarded([1, 2]), guarded(5)]);
attempt("a guard, null", () => guarded(null));
attempt("after a method", afterAMethod);
attempt("checked by a method", () => [checkedByAMethod("ab"), checkedByAMethod(7)]);
attempt("this is ready", thisIsReady);
attempt("a constant of type never", () => [typeof impossible, show(impossible)]);
attempt("void, undefined and null", () => {
  const a = nothing();
  const b = absent();
  const c = nil();
  return [show(a), typeof a, b === undefined, typeof b, b ?? "fallback", c === null, typeof c, c ?? "fallback"];
});
