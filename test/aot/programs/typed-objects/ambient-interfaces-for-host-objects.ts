// Interfaces written under `declare global` describe host objects. A host object that does not have a declared member passes every place of that type, and the member reads undefined, as in plain Bun.
declare global {
  namespace NodeJS { interface ProcessEnv { APP_REQUIRED_KEY: string; APP_OPTIONAL_KEY?: string } }
  interface HostThing { id: number; label: string }
  var hostThing: HostThing;
}
(globalThis as any).hostThing = { id: 1 };
(globalThis as any).process ??= { env: { HOME: "/home" } };
const copy: NodeJS.ProcessEnv = { ...process.env };
const same: NodeJS.ProcessEnv = process.env;
function keysOf(env: NodeJS.ProcessEnv): number { return Object.keys(env).length; }
console.log(typeof copy.APP_REQUIRED_KEY, typeof same.APP_REQUIRED_KEY, copy.APP_OPTIONAL_KEY, keysOf(copy) === keysOf(process.env), keysOf({ ...process.env, EXTRA: "1" }) - keysOf(copy));
const thing: HostThing = hostThing;
const spread: HostThing = { ...hostThing };
const made: HostThing = { id: 2, label: "made" };
function labelOf(t: HostThing): string { return String(t.label); }
console.log(thing.id, labelOf(thing), labelOf(spread), labelOf(made), thing === hostThing, JSON.stringify(spread), JSON.stringify(made));
export {};
