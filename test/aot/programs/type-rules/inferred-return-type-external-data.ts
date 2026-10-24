// A function whose return type is inferred may return external data that does not match the inferred type.
// Using the call as an operand must behave as in plain JavaScript instead of asserting the inferred type.
const data = JSON.parse('{"t":"abc","u":"d","l":["x","y"]}') as { t: number; u: number; l: number[] };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + String(v); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
const arrow = () => data.t;
function declared() { return data.t; }
function conditional(c: boolean) { return c ? data.t : 1; }
function viaLocal() { const v = data.t; return v; }
function nested() { return arrow(); }
function element(i: number) { return data.l[i]; }
function sum() { return data.t + data.u; }
const holder = { method() { return data.t; } };
class Reader { read() { return data.t; } static read() { return data.u; } }
async function later() { return data.t; }
const identity = <T,>(x: T) => x;
say("arrow() + 1", () => arrow() + 1);
say("1 + arrow()", () => 1 + arrow());
say("declared() + 1", () => declared() + 1);
say("conditional(true) + 1", () => conditional(true) + 1);
say("conditional(false) + 1", () => conditional(false) + 1);
say("viaLocal() + 1", () => viaLocal() + 1);
say("nested() + 1", () => nested() + 1);
say("element(0) + 1", () => element(0) + 1);
say("sum() + 1", () => sum() + 1);
say("arrow() + declared()", () => arrow() + declared());
say("arrow() * 2", () => arrow() * 2);
say("-arrow()", () => -arrow());
say("holder.method() + 1", () => holder.method() + 1);
say("new Reader().read() + 1", () => new Reader().read() + 1);
say("Reader.read() + 1", () => Reader.read() + 1);
say("identity(data.t) + 1", () => identity(data.t) + 1);
say("(() => data.t)() + 1", () => (() => data.t)() + 1);
(async () => { let w: unknown; try { w = (await later()) + 1; } catch (e) { w = "throws " + (e as Error).constructor.name; } say("(await later()) + 1", () => w); })();
