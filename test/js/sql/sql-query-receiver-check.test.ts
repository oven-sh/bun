// Query prototype members must brand-check their receiver. Previously
// cancel()/simple()/active/cancelled used Symbol-keyed storage with no guard,
// so calling them on a foreign `this` would return that object (and write a
// Symbol(status)/Symbol(flags) property onto it) instead of throwing. The
// other members already threw via private-method access; after the fix every
// member rejects a non-Query receiver with TypeError and leaves it untouched.
// No live database is needed: the URL points at a closed port that is never
// dialed because the brand check (or cancel) runs before any I/O.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

describe("Bun.SQL Query prototype rejects foreign receivers", () => {
  const sql = new SQL("postgres://u:p@127.0.0.1:1/db", { max: 1 });
  const q = sql`select 1`;
  q.cancel();
  q.catch(() => {});
  const proto = Object.getPrototypeOf(q);

  const methods = ["cancel", "simple", "resolve", "reject", "execute", "raw", "values"];
  test.each(methods)("%s() throws TypeError and does not mutate the receiver", name => {
    const stranger: Record<PropertyKey, unknown> = { hello: "world" };
    expect(() => proto[name].call(stranger)).toThrow(TypeError);
    expect(Object.getOwnPropertySymbols(stranger)).toEqual([]);
    expect(Object.keys(stranger)).toEqual(["hello"]);
  });

  for (const name of ["active", "cancelled"]) {
    test(`${name} getter throws TypeError`, () => {
      const { get } = Object.getOwnPropertyDescriptor(proto, name)!;
      expect(() => get!.call({})).toThrow(TypeError);
    });
  }

  test("active setter throws TypeError and does not mutate the receiver", () => {
    const { set } = Object.getOwnPropertyDescriptor(proto, "active")!;
    const stranger = {};
    expect(() => set!.call(stranger, true)).toThrow(TypeError);
    expect(Object.getOwnPropertySymbols(stranger)).toEqual([]);
  });

  test("inspect custom throws TypeError", () => {
    const inspect = proto[Symbol.for("nodejs.util.inspect.custom")];
    expect(() => inspect.call({})).toThrow(TypeError);
  });

  test("methods still work on a real Query", () => {
    const real = sql`select 1`;
    expect(real.active).toBe(false);
    expect(real.cancelled).toBe(false);
    expect(real.simple()).toBe(real);
    expect(real.cancel()).toBe(real);
    expect(real.cancelled).toBe(true);
    real.catch(() => {});
  });
});
