// `f.call(receiver)` and `f.apply(receiver, list)` where f is no function. The functions of the library that forward the call are those of the lowest program, so the place that is named
// and quoted lies in another program than the failure: behind an adapter, or, where the call is a tail call, tested before the frame is given up.
import { expect, test } from "bun:test";
const rows: string[] = [];
const show = (label: string, run: () => unknown) => {
  try {
    rows.push(label + " | " + String(run()));
  } catch (error) {
    rows.push(label + " | " + (error as Error).name + " " + (error as Error).message);
  }
};
test("refused calls through call and apply are named and quoted as written", () => {
  const f: any = Object.create(Function.prototype);
  const o: any = { f, deep: { f }, ok() { return 1; } };
  const list = [1, 2];
  let behind = 0;
  for (let round = 0; round < 3; round++) {
    show("a tail call: call", () => f.call(null, 1));
    show("a tail call: a member", () => o.f.call(null));
    show("a tail call: a member of a member", () => o.deep.f.call(o));
    show("a tail call: an optional chain", () => f?.call(null));
    show("a tail call: no arguments", () => f.call());
    show("a tail call: a spread", () => f.call(null, ...list));
    show("a tail call: apply", () => f.apply(null, list));
    show("call", () => { const r = f.call(null, 1); behind++; return r; });
    show("a member", () => { const r = o.f.call(null); behind++; return r; });
    show("a member of a member", () => { const r = o.deep.f.call(o); behind++; return r; });
    show("an optional chain", () => { const r = f?.call(null); behind++; return r; });
    show("no arguments", () => { const r = f.call(); behind++; return r; });
    show("a spread", () => { const r = f.call(null, ...list); behind++; return r; });
    show("apply", () => { const r = f.apply(null, list); behind++; return r; });
    show("apply without a list", () => { const r = f.apply(null); behind++; return r; });
    show("under try and finally", () => { try { return f.call(null, 1); } finally { behind++; } });
    show("as an argument", () => String(f.call(null, 1)));
    show("the second of two in a line", () => [o.ok.call(null, 1), f.call(null, 2)]);
    show("over two lines", () => {
      const r = f.call(
        null, 3);
      behind++;
      return r;
    });
    show("no call or apply", () => { const r = f(1); behind++; return r; });
    show("a member, no call or apply", () => { const r = o.f(2); behind++; return r; });
  }
  expect(rows.length).toBe(63);
  expect(rows.filter(text => text.includes("Function is not a function"))).toEqual([]);
  // The three rounds say the same.
  expect(rows.slice(21, 42)).toEqual(rows.slice(0, 21));
  expect(rows.slice(42)).toEqual(rows.slice(0, 21));
  for (const text of rows.slice(0, 21)) console.log("RESULT|66|" + text.replace(" | ", "|-|"));
});
