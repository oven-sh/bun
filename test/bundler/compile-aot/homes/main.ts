const out: string[] = [];
const say = (name: string, f: () => unknown) => {
  let text: string;
  try { text = String(f()); } catch (e: any) { text = "threw " + (e?.name ?? typeof e) + ": " + (e?.message ?? String(e)); }
  out.push(name + " = " + text);
};
let countdown = -1;
class Boom extends Error { constructor(public at: number) { super("boom " + at); this.name = "Boom"; } }
let ticks = 0;
function tick<T>(x: T): T { ticks++; if (countdown-- === 0) throw new Boom(ticks); return x; }
function pair(a: unknown, b: unknown) { return a + "/" + b; }
function three(a: unknown, b: unknown, c: unknown) { return a + "/" + b + "/" + c; }
function everywhere(name: string, f: () => unknown) {
  for (let n = 0; n < 40; n++) {
    countdown = n; ticks = 0;
    let text: string;
    try { text = String(f()); } catch (e: any) { text = "threw " + (e?.name ?? typeof e) + ": " + (e?.message ?? String(e)); }
    const done = countdown >= 0;
    countdown = -1;
    out.push(name + " [" + n + "] = " + text);
    if (done) break;
  }
}

everywhere("written before, in, and after", () => {
  let a = tick(1), b = "b0", c: unknown = null;
  try { a = tick(2); b = tick("b1"); c = tick({ toString() { return "c1"; } }); a = tick(3); }
  catch (e: any) { return three(a, b, c) + " caught " + e.at; }
  a = tick(4); b = tick("b2");
  return three(a, b, c);
});

everywhere("finally sees them, and so does what comes after", () => {
  let a = 0, log = "";
  try { a = tick(1); log += "x"; a = tick(2); log += "y"; }
  finally { log += "[" + a + "]"; }
  const t1 = pair(tick(a), tick(log)), t2 = pair(tick(log), tick(a));
  return pair(t1, t2);
});

everywhere("one in another", () => {
  let a = "a0", b = "b0", c = "c0";
  try {
    a = tick("a1");
    try { b = tick("b1"); c = tick("c1"); b = tick("b2"); }
    catch (e: any) { c = tick("c2:" + three(a, b, c)); a = tick("a2"); }
    finally { b = tick(b + "!"); }
    a = tick(a + "+");
  } catch (e: any) { return "outer " + three(a, b, c); }
  return three(a, b, c);
});

everywhere("for of, then calls that use the same registers", () => {
  let sum = 0, last: unknown = "none";
  for (const x of [tick(1), tick(2), tick(3)]) { sum += tick(x); last = x; if (x === 2) continue; sum += tick(10); }
  const p = pair(tick(sum), tick(last));
  for (const [k, v] of Object.entries({ a: tick("A"), b: tick("B") })) { last = pair(tick(k), tick(v)); }
  return three(tick(p), tick(last), tick(sum));
});

everywhere("for of in a try, left early", () => {
  let seen = "", closed = 0;
  const iterable = { [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i >= 4, value: tick(i++) }), return() { closed++; tick(0); return {}; } }; } };
  try { for (const x of iterable) { seen += tick(x); if (x === 2) break; } }
  catch (e: any) { return "caught " + three(seen, closed, e.at); }
  return three(tick(seen), tick(closed), pair(tick(1), tick(2)));
});

everywhere("a loop round a try", () => {
  let text = "", tries = 0;
  for (let i = 0; i < 4; i++) {
    let local = "l" + i;
    try { tries++; local = tick(local + "a"); text += local; local = tick(local + "b"); if (i === 1) continue; if (i === 3) break; text += tick("."); }
    catch (e: any) { text += "<" + local + ">"; }
    finally { text += "|" + tries; }
  }
  return pair(tick(text), tick(tries));
});

everywhere("return by way of finally", () => {
  let a = "a0";
  const inner = () => { try { a = tick("a1"); return tick("returned " + a); } finally { a = tick(a + "f"); } };
  let r: unknown = "r0";
  try { r = inner(); } catch (e: any) { r = "caught " + e.at; }
  return pair(r, a);
});

everywhere("thrown again", () => {
  let a = 0, b = 0;
  try {
    try { a = tick(1); b = tick(2); } catch (e) { a += 10; b = tick(b + 20); throw e; }
  } catch (e: any) { return three(a, b, e.at); }
  return pair(tick(a), tick(b));
});

everywhere("numbers of every kind, kept as numbers", () => {
  let i = 1, d = 0.5, s = "";
  try { for (let k = 0; k < 3; k++) { i = tick(i * 3); d = tick(d + 0.25); s += tick(k); } }
  catch (e: any) { return three(i, d, s) + " caught"; }
  return three(tick(i) + 1, tick(d) * 2, tick(s));
});

everywhere("arguments and defaults", () => {
  function f(a: number, b = tick(a + 1), c?: unknown) {
    try { a = tick(a * 2); c = tick("c"); b = tick(b * 2); } catch (e: any) { return "caught " + three(a, b, c); }
    return three(a, b, c);
  }
  return pair(f(tick(1)), f(tick(2), tick(5)));
});

function* generates() { let a = "g0"; try { a = tick("g1"); yield a; a = tick("g2"); yield a; } catch (e: any) { yield "caught " + a; } finally { yield "finally " + a; } }
everywhere("a generator", () => { let text = ""; for (const x of generates()) text += tick(x) + ","; return text; });

async function awaits() { let a = "w0", b = 0; try { a = tick("w1"); b = await tick(1); a = tick("w2"); b += await Promise.resolve(tick(2)); } catch (e: any) { return "caught " + pair(a, b); } finally { a += "f"; } return pair(tick(a), tick(b)); }
for (let n = 0; n < 12; n++) { countdown = n; ticks = 0; let text: string; try { text = String(await awaits()); } catch (e: any) { text = "threw " + e.message; } const done = countdown >= 0; countdown = -1; out.push("async [" + n + "] = " + text); if (done) break; }

everywhere("switch and labels", () => {
  let a = "s0", n = 0;
  outer: for (let i = 0; i < 3; i++) {
    try { switch (tick(i)) { case 0: a = tick("zero"); break; case 1: a = tick("one"); continue outer; default: a = tick("many"); break outer; } n += tick(1); }
    catch (e: any) { a = "caught " + a; break; }
    finally { n += 100; }
  }
  return pair(tick(a), tick(n));
});

everywhere("destructuring in a try", () => {
  let a: unknown = "a", b: unknown = "b", rest: unknown[] = [];
  try { [a, b, ...rest] = [tick(1), tick(2), tick(3), tick(4)]; ({ a, b } = { a: tick("A"), b: tick("B") }); }
  catch (e: any) { return "caught " + three(a, b, rest); }
  return three(a, b, rest);
});

say("a getter that throws", () => { let a = 1; const o = { get g() { throw new Boom(a); } }; try { a = 2; a = o.g as any; a = 3; } catch (e: any) { return pair(a, e.at); } return a; });
say("too deep", () => { let depth = 0, seen = -1; const f = (): number => { depth++; return f() + 1; }; try { f(); } catch (e: any) { seen = depth > 100 ? 1 : 0; } return pair(seen, typeof depth); });
console.log(out.join("\n"));
