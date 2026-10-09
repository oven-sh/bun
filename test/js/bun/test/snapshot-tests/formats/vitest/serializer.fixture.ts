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
});
