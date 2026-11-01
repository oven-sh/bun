// `test`, `describe` and `beforeAll` of bun:test for a file whose tests all need `--aot`. Where the Bun under test refuses the
// flag (harness/compiler.ts asks it, and says so on stderr) every test is skipped, whatever is chained to it, and `beforeAll` does
// nothing. Where CI leaves the file out (harness/every-build.ts) they declare nothing.
import { describe as describeAnywhere } from "bun:test";
import { isASAN } from "harness";
import { unsupported } from "./harness/compiler";
import { raiseDefaultTimeout, raisingLimits, whereverTheFileRuns } from "./harness/default-timeout";
import { boundTo, isThisFileLeftOut, unlessLeftOut } from "./harness/left-out";

export { unsupported };

// One build takes about as long as the whole default limit of bun:test.
raiseDefaultTimeout(120_000);

const { test: testAnywhere, beforeAll: beforeAllAnywhere } = whereverTheFileRuns;

// bun:test refuses `.skipIf()`, `.todo` and the like on what is skipped already.
export function alwaysSkipped<T extends object>(skipped: T): T {
  return new Proxy(skipped, {
    get(target, name, self) {
      if (typeof name === "string" && /^(skip|todo|failing|concurrent|serial)?[iI]f$/.test(name)) return () => self;
      if (name === "skip" || name === "todo" || name === "only" || name === "failing") return self;
      const value = Reflect.get(target, name, target);
      if (name === "concurrent" || name === "serial") return alwaysSkipped(value as object);
      return typeof value === "function" ? boundTo(target, value) : value;
    },
  });
}

// bun:test refuses `.serial` and `.concurrent` on what is concurrent already.
function besideOneAnother(declares: typeof testAnywhere): typeof testAnywhere {
  const calledOnItsOwner = raisingLimits(declares, true);
  return new Proxy(calledOnItsOwner.concurrent, {
    get: (concurrent, name) =>
      Reflect.get(name === "serial" || name === "concurrent" ? calledOnItsOwner : concurrent, name),
  });
}

// With a sanitizer a case waits for one slow child after another and keeps one processor of eight busy, so the cases of a file run
// beside one another there, as many as `--max-concurrency` says. `test.serial` is for a case that must not. AOT_CASES_AT_ONCE=1 | 0 asks for either anywhere.
const atOnce = process.env.AOT_CASES_AT_ONCE ? process.env.AOT_CASES_AT_ONCE === "1" : isASAN;
const declared = atOnce ? besideOneAnother(testAnywhere) : testAnywhere;
const skippedTest = alwaysSkipped(testAnywhere.skip);
const skippedDescribe = alwaysSkipped(describeAnywhere.skip);
export const test = unsupported ? skippedTest : unlessLeftOut(declared);
/** `test` for a file whose cases never run beside one another. The file says why. */
export const testOneByOne = unsupported ? skippedTest : unlessLeftOut(testAnywhere);
export const describe = unsupported ? skippedDescribe : unlessLeftOut(describeAnywhere);
export const beforeAll: typeof beforeAllAnywhere = unsupported
  ? () => {}
  : (...operands) => (isThisFileLeftOut() ? undefined : beforeAllAnywhere(...operands));

const rowsNotMetYet = new WeakSet<object>();

/** Marks a row of a table for `eachRow`: it states what should be so and is not so yet, and `why` says what happens today. */
export function gap<Row extends object>(why: string, row: Row): Row {
  if (!why) throw new Error("gap() needs a reason");
  rowsNotMetYet.add(row);
  return row;
}

/** `test.each`, but a row that is wrapped in `gap()` is listed as a todo. `bun test --todo` says which of those rows have come true. */
export function eachRow<Row extends readonly unknown[]>(rows: readonly Row[]) {
  return (title: string, body: (...row: Row) => unknown, timeout?: number) => {
    const met = rows.filter(row => !rowsNotMetYet.has(row));
    const notMet = rows.filter(row => rowsNotMetYet.has(row));
    if (met.length) test.each(met as Row[])(title, body as (...row: unknown[]) => unknown, timeout);
    if (notMet.length) test.todo.each(notMet as Row[])(title, body as (...row: unknown[]) => unknown, timeout);
  };
}
