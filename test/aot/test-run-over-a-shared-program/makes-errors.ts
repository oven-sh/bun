// Something is done behind each call, so that it is no tail call: a constant that is used once is put in its place, [x][0] is x, and `return f()` gives up the frame.
let behindCalls = 0;
export const countBehindCalls = () => behindCalls;
export class Failure extends Error {}
export function makes(message: string) {
  const e = new Failure(message);
  behindCalls++;
  return e;
}
export function calls<T>(f: () => T): T {
  const r = f();
  behindCalls++;
  return r;
}
export class Holder {
  method<T>(f: () => T): T {
    const r = f();
    behindCalls++;
    return r;
  }
  static fixed<T>(f: () => T): T {
    const r = f();
    behindCalls++;
    return r;
  }
  constructor(f?: () => unknown) {
    if (f) f();
  }
}
export async function later<T>(f: () => T | Promise<T>): Promise<T> {
  await null;
  const r = await f();
  behindCalls++;
  return r;
}
export function captures(target: object, above?: Function) {
  Error.captureStackTrace(target, above);
  return target;
}
export function reads(e: Error) {
  const text = e.stack;
  behindCalls++;
  return text;
}
export function sitesHere() {
  const old = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, sites) => sites;
  const sites = new Error("x").stack as unknown as NodeJS.CallSite[];
  Error.prepareStackTrace = old;
  return sites;
}
export const kept: Error[] = [];
export function keeps(message: string) {
  kept.push(new Failure(message));
  return kept.length;
}
