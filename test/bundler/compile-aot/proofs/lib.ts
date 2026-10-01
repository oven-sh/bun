// What ought to be proven, and everything that ought not to be.
export function plain(a: number, b: number) { return a + b; }
export const arrow = (a: number) => a * 2;
export const expr = function named(a: number) { return a - 1; };
export class Klass { v: number; constructor(v: number) { this.v = v; } get() { return this.v; } }
export class Derived extends Klass { get() { return super.get() + 100; } }

// Reassigned by the module's own top level code.
export function reassignedAtTop() { return "first"; }
(reassignedAtTop as any) = function () { return "second"; };

// Reassigned by a function of the module, later.
export function reassignedLater() { return "before"; }
export function reassign() { (reassignedLater as any) = () => "after"; }

// Reassigned from two levels down.
export let letFunction = () => "let 1";
export function reassignDeep() { return () => { letFunction = () => "let 2"; }; }

// One of two.
export const conditional = (globalThis as any).nothingHere ? function a() { return "a"; } : function b() { return "b"; };
export let assignedInBranch: () => string;
if ((globalThis as any).nothingHere) assignedInBranch = () => "yes"; else assignedInBranch = () => "no";

// The register is written again before the store.
let temp: any = function overwritten() { return "wrong"; };
temp = ((f: any) => () => "wrapped " + f())(temp);
export const wrapped = temp;

// A class that is assigned to.
export class Replaced { name() { return "original"; } }
export function replaceClass() { (Replaced as any) = class { name() { return "replacement"; } }; }

// Fewer and more arguments than parameters.
export function arity(a?: number, b?: number, c?: number) { return [a, b, c, arguments.length].join(); }

// Calls itself, and another that calls it back.
export function even(n: number): boolean { return n === 0 ? true : odd(n - 1); }
export function odd(n: number): boolean { return n === 0 ? false : even(n - 1); }

// Used as a value as well as called.
export function both(x: number) { return x + 1000; }
export const table = { both };

// Throws, and is caught by the caller.
export function thrower(): never { throw new Error("thrown by thrower"); }

// Never called before the caller in another module does.
export function firstCallIsDirect(x: number) { const local = { x }; return () => local.x + 1; }

export function callsWithinModule() { return [plain(1, 2), arrow(3), expr(4), new Klass(5).get(), new Derived(6).get(), reassignedAtTop(), reassignedLater(), letFunction(), conditional(), assignedInBranch(), wrapped(), new Replaced().name()].join(); }
