import { expect, test } from "bun:test";

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

class Color {
  constructor(public name: string) {}
}

class Size {
  constructor(
    public width: number,
    public height: number,
  ) {}
}

class ThrowInTest {
  value = 42;
}

class ThrowInSerialize {
  value = 99;
}

class ReturnNonString {
  value = 123;
}

// Add serializers at the top level
expect.addSnapshotSerializer({
  test: val => val instanceof Point,
  serialize: val => `Point(${val.x}, ${val.y})`,
});

expect.addSnapshotSerializer({
  test: val => val instanceof Color,
  serialize: val => `Color[${val.name}]`,
});

// Add a second Point serializer to test that most recent wins
expect.addSnapshotSerializer({
  test: val => val instanceof Point,
  serialize: val => `OVERRIDE: Point(${val.x}, ${val.y})`,
});

expect.addSnapshotSerializer({
  test: val => val instanceof Size,
  print: val => `Size{${val.width}x${val.height}}`,
});

expect.addSnapshotSerializer({
  test: val => {
    if (val instanceof ThrowInTest) {
      throw new Error("Test function error");
    }
    return false;
  },
  serialize: val => `ThrowInTest(${val.value})`,
});

expect.addSnapshotSerializer({
  test: val => val instanceof ThrowInSerialize,
  serialize: () => {
    throw new Error("Serialize function error");
  },
});

expect.addSnapshotSerializer({
  test: val => val instanceof ReturnNonString,
  serialize: val => val.value, // Returns a number, not a string
});

test("snapshot serializers work for custom formatting", () => {
  const color = new Color("red");
  expect(color).toMatchInlineSnapshot(`Color[red]`);
});

test("most recently added serializer is used when multiple match", () => {
  // The second Point serializer should be used (most recent wins)
  const point = new Point(10, 20);
  expect(point).toMatchInlineSnapshot(`OVERRIDE: Point(10, 20)`);
});

test("snapshot serializer with 'print' instead of 'serialize'", () => {
  const size = new Size(100, 200);
  expect(size).toMatchInlineSnapshot(`Size{100x200}`);
});

test("snapshot serializers apply to object fields", () => {
  const obj = {
    color: new Color("blue"),
    size: new Size(640, 480),
  };
  expect(obj).toMatchInlineSnapshot(`
    {
      "color": Color[blue],
      "size": Size{640x480},
    }
  `);
});

test("test function throwing error propagates to expect()", () => {
  const obj = new ThrowInTest();
  expect(() => {
    expect(obj).toMatchInlineSnapshot();
  }).toThrow("Test function error");
});

test("serialize function throwing error propagates to expect()", () => {
  const obj = new ThrowInSerialize();
  expect(() => {
    expect(obj).toMatchInlineSnapshot();
  }).toThrow("Serialize function error");
});

test("serialize function returning non-string throws error", () => {
  const obj = new ReturnNonString();
  expect(() => {
    expect(obj).toMatchInlineSnapshot();
  }).toThrow("Snapshot serializer serialize callback must return a string");
});
