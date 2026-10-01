// Functions of a module that are called as no object at all, and what could tell.
import { far1, far2, mutual } from "./noobject2";

export function plain(a: number, b: number) { return a + b; }
export function fewer(a: number, b?: number, c = 3) { return [a, b, c].join(); }
export function more(a: number) { return a; }
export function makesClosure(x: number) { return () => x + counter; }
export let counter = 10;
export function bump() { counter++; return counter; }
export function callsOthers(n: number): number { return n <= 0 ? plain(1, 2) : callsOthers(n - 1) + plain(n, 0); }
export const arrow = (x: number) => x * 2;
export const usesArrow = (x: number) => arrow(x) + plain(x, 1);
export function throws(): never { throw new Error("thrown"); }
export function catches() { try { throws(); } catch (e: any) { return e.message + " " + names(e); } }
export function names(e: Error) { return e.stack!.split("\n").slice(1, 5).map(l => l.trim().split(" ")[1]).join(">"); }
export function trims() { const e: any = {}; Error.captureStackTrace(e, trims); return names(e); }
export function callsTrims() { return trims(); }
export const anonymousTrims = [() => { const e: any = {}; Error.captureStackTrace(e, anonymousTrims); return names(e); }][0]!;
export function callsAnonymousTrims() { return anonymousTrims(); }
export function sites() { const old = Error.prepareStackTrace; Error.prepareStackTrace = (_, s) => s.slice(0, 3).map(c => [c.getFunctionName(), typeof c.getFunction(), typeof c.getThis(), c.isToplevel(), c.isNative()].join("/")).join(" "); const r = new Error().stack; Error.prepareStackTrace = old; return r; }
export function callsSites() { return sites(); }
export function deep(n: number): number { return n ? deep(n - 1) + 1 : 0; }
export function overflow(): number { return overflow() + 1; }
export function catchesOverflow() { try { return overflow(); } catch (e: any) { return e.constructor.name; } }
export function asValue() { return [plain, arrow, plain === plain, typeof plain, plain.name, plain.length].join(); }
export function usesArguments() { return arguments.length; }
export function selfReference() { return selfReference.name; }
export function tail(n: number): number { "use strict"; return n ? tail(n - 1) : 42; }
export async function asyncOne(x: number) { await null; return plain(x, 1); }
export function* generatorOne(x: number) { yield plain(x, 1); yield arrow(x); }
export function early() { return late(); }
export const beforeInit = (() => { try { return notYet(1); } catch (e: any) { return e.constructor.name; } })();
export const beforeInitNew = (() => { try { return typeof new NotYetClass(); } catch (e: any) { return e.constructor.name; } })();
export const beforeInitMessage = (() => { try { return notYet(1); } catch (e: any) { return e.message; } })();
export const notYet = (x: number) => x;
export class NotYetClass { x = 1; }
export function late() { return "late"; }
export function withThis(this: unknown) { return this === undefined; }
export function gc() { Bun.gc(true); return plain(1, 1); }
export function imports() { return [far1(1), far2(2), mutual(3)].join(); }
export function calledBack(n: number): number { return n * 2; }
