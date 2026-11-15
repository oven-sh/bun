// @ts-nocheck
import { describe, test, expect } from "vitest";

class Money {
  constructor(
    public amount: number,
    public currency: string,
  ) {}
}
class Wrapper {
  constructor(public inner: unknown) {}
}
class Old {
  v = 1;
}
class Hidden {
  #inner: unknown;
  constructor(inner: unknown) {
    this.#inner = inner;
  }
  get inner() {
    return this.#inner;
  }
}

expect.addSnapshotSerializer({
  test: v => v instanceof Money,
  serialize: (v: Money) => `Money<${v.amount} ${v.currency}>`,
});
expect.addSnapshotSerializer({
  test: v => v instanceof Wrapper,
  serialize(v: Wrapper, config, indentation, depth, refs, printer) {
    return `Wrapper(${printer(v.inner, config, indentation, depth, refs)})`;
  },
});
expect.addSnapshotSerializer({
  test: v => v instanceof Old,
  print: (v: any, print: any, indent: any) => "Old:\n" + indent(print({ v: v.v })),
} as any);
expect.addSnapshotSerializer({
  test: v => typeof v === "string" && v.startsWith("raw:"),
  serialize: (v: string) => v.slice(4),
});
expect.addSnapshotSerializer({
  test: v => v instanceof Hidden,
  serialize(v: Hidden, config, indentation, depth, refs, printer) {
    return `Hidden(${printer(v.inner, config, indentation, depth, refs)})`;
  },
});

describe("serializers", () => {
  test("top level", () => {
    expect(new Money(5, "EUR")).toMatchSnapshot();
  });
  test("nested", () => {
    expect({ price: new Money(1, "USD"), list: [new Money(2, "GBP")] }).toMatchSnapshot();
  });
  test("printer", () => {
    expect(new Wrapper({ a: [1, new Money(3, "JPY")] })).toMatchSnapshot();
  });
  test("printer, nested", () => {
    expect({ w: new Wrapper({ deep: new Wrapper(1) }) }).toMatchSnapshot();
  });
  test("old api", () => {
    expect(new Old()).toMatchSnapshot();
    expect([new Old()]).toMatchSnapshot();
  });
  test("strings", () => {
    expect("raw:no quotes").toMatchSnapshot();
    expect("raw:multi\nline").toMatchSnapshot();
    expect({ s: "raw:in object" }).toMatchSnapshot();
  });
  test("inline", () => {
    expect(new Money(9, "CHF")).toMatchInlineSnapshot(`Money<9 CHF>`);
  });
  test("last added wins", () => {
    expect.addSnapshotSerializer({
      test: v => v instanceof Money && v.currency === "XXX",
      serialize: () => "override",
    });
    expect(new Money(1, "XXX")).toMatchSnapshot();
  });
  test("in a Map and a Set", () => {
    expect(new Map([[new Money(1, "A"), new Set([new Money(2, "B")])]])).toMatchSnapshot();
  });
  test("not in the arguments of a custom matcher", () => {
    expect([
      new Money(1, "USD"),
      (expect as any).toBeFoo(new Money(2, "GBP"), { nested: new Wrapper("raw:text") }, "raw:text"),
    ]).toMatchSnapshot();
  });
  test("printer and print, of a custom matcher", () => {
    expect(new Wrapper([(expect as any).toBeFoo(/a+/, [new Money(3, "JPY")])])).toMatchSnapshot();
    expect(Object.assign(new Old(), { v: (expect as any).not.toBeFoo(/b+/, new Old()) })).toMatchSnapshot();
  });
  test("a custom matcher of what holds it, behind what only a serializer prints", () => {
    const holder: any = { name: "h" };
    holder.hidden = new Hidden((expect as any).toBeFoo(holder));
    expect(holder).toMatchSnapshot();
  });
});

expect.extend({
  toBeFoo() {
    return { pass: true, message: () => "" };
  },
});
