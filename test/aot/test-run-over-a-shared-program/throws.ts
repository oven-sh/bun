// Something is done behind each call, so that it is no tail call: a constant that is used once is put in its place, [x][0] is x, and `return f()` gives up the frame.
let behindCalls = 0;
export const countBehindCalls = () => behindCalls;
export class Failure extends Error {
  constructor(message: string, public code = 7) {
    super(message);
    this.name = "Failure";
  }
}
export class DeeperFailure extends Failure {
  constructor(message: string) {
    super(message, 8);
    this.name = "DeeperFailure";
  }
}
export function fail(message: string): never {
  throw new Failure(message);
}
export function failWith(value: unknown): never {
  throw value;
}
export function calls<T>(f: () => T): T {
  const r = f();
  behindCalls++;
  return r;
}
export function tailCalls<T>(f: () => T): T {
  return f();
}
export function deep<T>(n: number, f: () => T): T {
  const r = n ? deep(n - 1, f) : f();
  behindCalls++;
  return r;
}
const text = (e: unknown) => String((e as any)?.message ?? e);
export function catches<T>(f: () => T): T | string {
  try {
    const r = f();
    behindCalls++;
    return r;
  } catch (e) {
    return "caught in the library: " + text(e);
  }
}
export function cleansUp<T>(log: string[], f: () => T): T {
  try {
    const r = f();
    behindCalls++;
    return r;
  } finally {
    log.push("library cleanup");
  }
}
export function rethrows<T>(log: string[], f: () => T): T {
  try {
    const r = f();
    behindCalls++;
    return r;
  } catch (e) {
    log.push("library saw " + text(e));
    throw e;
  }
}
export function replaces<T>(f: () => T): T {
  try {
    const r = f();
    behindCalls++;
    return r;
  } catch (e) {
    throw new Failure("replaced " + text(e), 9);
  }
}
export function overrides(f: () => unknown) {
  try {
    f();
    return "returned";
  } finally {
    // eslint-disable-next-line no-unsafe-finally
    return "the answer of the cleanup";
  }
}
export class Runs {
  ran = "not yet";
  constructor(f: () => void) {
    f();
    this.ran = "ran";
  }
}
export class RunsToo extends Runs {
  constructor(f: () => void) {
    super(f);
  }
}
export function* steps(log: string[], f: () => unknown) {
  try {
    yield 1;
    f();
    yield 2;
  } finally {
    log.push("generator cleanup");
  }
}
export async function later<T>(f: () => T) {
  await null;
  const r = f();
  behindCalls++;
  return r;
}
export async function laterCatches(f: () => unknown) {
  try {
    await null;
    const r = await f();
    behindCalls++;
    return r;
  } catch (e) {
    return "caught later in the library: " + text(e);
  }
}
export function overList<T, U>(list: T[], f: (x: T) => U) {
  const r = list.map(f);
  behindCalls++;
  return r;
}
export const holder = {
  get failing(): number {
    throw new Failure("from a getter");
  },
  set failing(value: number) {
    throw new Failure("from a setter " + value);
  },
};
export function overflows(n: number): number {
  return overflows(n + 1) + 1;
}
export function readsNull(value: any) {
  const r = value.inner.name;
  behindCalls++;
  return r;
}
export function keeps(values: number[], f: () => unknown) {
  let a = values[0], b = values[1], c = values[2], d = values[3], e = values[4], g = values[5];
  try {
    f();
  } catch {
    return [a, b, c, d, e, g].join();
  }
  return "no throw " + (a + b + c + d + e + g);
}
