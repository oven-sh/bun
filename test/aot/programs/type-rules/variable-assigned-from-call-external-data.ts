// A variable whose type is only inferred is assigned the result of a function whose return type is only inferred, and the function returns external data of another type.
// The assignment and later uses must behave as in plain JavaScript instead of asserting the inferred type.
const data = JSON.parse('{"t":"abc"}') as { t: number };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + String(v); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
const arrow = () => data.t;
function declared() { return data.t; }
const twice = () => arrow();
const holder = { method() { return data.t; } };
say("n += f()", () => { let n = 0; n += arrow(); return n; });
say("n = f()", () => { let n = 0; n = arrow(); return n + 1; });
say("n = f() of a declaration", () => { let n = 0; n = declared(); return n + 1; });
say("n = f() through another function", () => { let n = 0; n = twice(); return n + 1; });
say("n = o.m()", () => { let n = 0; n = holder.method(); return n + 1; });
say("n -= f()", () => { let n = 0; n -= arrow(); return n; });
say("in a loop", () => { let n = 0; for (let i = 0; i < 2; i++) n += arrow(); return n; });
say("n = (() => ..)()", () => { let n = 0; n = (() => data.t)(); return n + 1; });
say("n += (function () { .. })()", () => { let n = 0; n += (function () { return data.t; })(); return n; });
say("n = (() => { a variable assigned in a callback })()", () => { const list = [data.t]; let n = 0; n = (() => { let last = 0; list.forEach(v => { last = v; }); return last; })(); n++; return n; });
say("trusted stays exact", () => { const one = () => 1; let n = 0; n += one(); return n + 1; });
