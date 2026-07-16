import { expect, it } from "bun:test";
import emptyToml from "./toml-empty.toml";
import tomlFromCustomTypeAttribute from "./toml-fixture.toml.txt" with { type: "toml" };

function checkToml(toml) {
  expect(toml.framework).toBe("next");
  expect(toml.bundle.packages["@emotion/react"]).toBe(true);
  expect(toml.array[0].entry_one).toBe("one");
  expect(toml.array[0].entry_two).toBe("two");
  expect(toml.array[1].entry_one).toBe("three");
  expect(toml.array[1].entry_two).toBe(undefined);
  expect(toml.array[1].nested[0].entry_one).toBe("four");
  expect(toml.dev.one.two.three).toBe(4);
  expect(toml.dev.foo).toBe(123);
  expect(toml.inline.array[0]).toBe(1234);
  expect(toml.inline.array[1]).toBe(4);
  expect(toml.dev["foo.bar"]).toBe("baz");
  expect(toml.install.scopes["@mybigcompany"].url).toBe("https://registry.mybigcompany.com");
  expect(toml.install.scopes["@mybigcompany2"].url).toBe("https://registry.mybigcompany.com");
  expect(toml.install.scopes["@mybigcompany3"].three).toBe(4);
  expect(toml.install.cache.dir).toBe("C:\\Windows\\System32");
  expect(toml.install.cache.dir2).toBe("C:\\Windows\\System32\\🏳️‍🌈");
}

it("via dynamic import", async () => {
  const toml = (await import("./toml-fixture.toml")).default;
  checkToml(toml);
});

it("via import type toml", async () => {
  checkToml(tomlFromCustomTypeAttribute);
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./toml-fixture.toml.txt")];
  const toml = (await import("./toml-fixture.toml.txt", { with: { type: "toml" } })).default;
  checkToml(toml);
});

it("empty via import statement", () => {
  expect(emptyToml).toEqual({});
});

it("inline table followed by table array", () => {
  const tomlContent = `
[global]
inline_table = { q1 = 1 }

[[items]]
q1 = 1
q2 = 2

[[items]]
q1 = 3
q2 = 4
`;

  // Test via Bun's internal TOML parser
  const Bun = globalThis.Bun;
  const parsed = Bun.TOML.parse(tomlContent);

  expect(parsed.global).toEqual({
    inline_table: { q1: 1 },
  });
  expect(parsed.items).toEqual([
    { q1: 1, q2: 2 },
    { q1: 3, q2: 4 },
  ]);
});

it("array followed by table array", () => {
  const tomlContent = `
[global]
array = [1, 2, 3]

[[items]]
q1 = 1
`;

  const Bun = globalThis.Bun;
  const parsed = Bun.TOML.parse(tomlContent);

  expect(parsed.global).toEqual({
    array: [1, 2, 3],
  });
  expect(parsed.items).toEqual([{ q1: 1 }]);
});

it("nested inline tables", () => {
  const tomlContent = `
[global]
nested = { outer = { inner = 1 } }

[[items]]
q1 = 1
`;

  const Bun = globalThis.Bun;
  const parsed = Bun.TOML.parse(tomlContent);

  expect(parsed.global).toEqual({
    nested: { outer: { inner: 1 } },
  });
  expect(parsed.items).toEqual([{ q1: 1 }]);
});

it("Bun.TOML.parse throws on deeply nested inline tables instead of crashing", () => {
  // Calibrated to exhaust the 18 MB main-thread stack at the smallest expected
  // per-recursion frame size (~100 B in release builds). Previously 25_000.
  const depth = 200_000;
  const deepToml =
    "a = " + Buffer.alloc(depth * 6, "{ b = ").toString() + "1" + Buffer.alloc(depth * 2, " }").toString();
  expect(() => Bun.TOML.parse(deepToml)).toThrow(RangeError);
});

it("Bun.TOML.parse never throws undefined for deeply nested inline tables", () => {
  // In a depth window the parser's stack guard stays quiet but the printer's
  // trips; the printer logs nothing, so the old error path did `throw undefined`.
  // The window moves with frame size, so calibrate by doubling, then sweep.
  const thrown = d => {
    const s = "a = " + Buffer.alloc(d * 6, "{ b = ").toString() + "1" + Buffer.alloc(d * 2, " }").toString();
    try {
      Bun.TOML.parse(s);
      return null;
    } catch (e) {
      return { e };
    }
  };

  let hi = 0;
  for (let d = 500; d <= 200_000; d *= 2) {
    if (thrown(d) !== null) {
      hi = d;
      break;
    }
  }
  expect(hi).toBeGreaterThan(0);

  const lo = hi >> 1;
  const step = Math.max(1, lo >> 2);
  let threw = 0;
  for (let d = lo + step; d <= hi * 4; d += step) {
    const r = thrown(d);
    if (r === null) continue;
    threw++;
    if (!(r.e instanceof Error)) {
      throw new Error(`depth ${d}: Bun.TOML.parse threw a non-Error value: ${String(r.e)}`);
    }
    expect(r.e).toBeInstanceOf(RangeError);
  }
  expect(threw).toBeGreaterThan(0);
});
