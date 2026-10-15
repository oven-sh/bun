import { expect, test } from "bun:test";

test("the received object is not modified", () => {
  const received = { j: 2, a: "any", below: { when: new Date(0), list: [{ n: 1 }, { n: 2 }], other: { kept: true } } };
  const { below } = received;
  const { list, other } = below;
  expect(received).toMatchInlineSnapshot(
    { j: expect.any(Number), below: { when: expect.any(Date), list: [{ n: expect.any(Number) }, { n: 2 }] } },
    `
    {
      "a": "any",
      "below": {
        "list": [
          {
            "n": Any<Number>,
          },
          {
            "n": 2,
          },
        ],
        "other": {
          "kept": true,
        },
        "when": Any<Date>,
      },
      "j": Any<Number>,
    }
  `,
  );
  expect(received.j).toBe(2);
  expect(received.below).toBe(below);
  expect(below.when).toEqual(new Date(0));
  expect(below.list).toBe(list);
  expect(list).toEqual([{ n: 1 }, { n: 2 }]);
  expect(below.other).toBe(other);
  expect(Object.keys(received)).toEqual(["j", "a", "below"]);
});

test("a class instance is printed with its class name", () => {
  class Point {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  const point = new Point(1, 2);
  expect(point).toMatchInlineSnapshot(
    { x: expect.any(Number) },
    `
    Point {
      "x": Any<Number>,
      "y": 2,
    }
  `,
  );
  expect(point.x).toBe(1);
  expect(point).toBeInstanceOf(Point);
});

test("a frozen object can be matched", () => {
  const frozen = Object.freeze({ id: 7, name: "n" });
  expect(frozen).toMatchInlineSnapshot(
    { id: expect.any(Number) },
    `
    {
      "id": Any<Number>,
      "name": "n",
    }
  `,
  );
  expect(frozen.id).toBe(7);
});

test("the matchers are not modified", () => {
  const matchers = { j: 5, below: { k: "s" } };
  const { below } = matchers;
  expect({ j: expect.any(Number), below: { k: expect.any(String) } }).toMatchInlineSnapshot(
    matchers,
    `
    {
      "below": {
        "k": Any<String>,
      },
      "j": Any<Number>,
    }
  `,
  );
  expect(matchers.j).toBe(5);
  expect(matchers.below).toBe(below);
  expect(below.k).toBe("s");
});

test("a failing toMatchObject omits the properties whose matchers passed, and modifies nothing", () => {
  const received = { j: 2, k: "s", below: { n: 1, m: "x" } };
  const expected = { j: expect.any(Number), k: expect.any(Number), below: { n: expect.any(Number), m: "y" } };
  let message = "";
  try {
    expect(received).toMatchObject(expected);
  } catch (error) {
    message = Bun.stripANSI(String((error as Error).message));
  }
  expect(message).toContain('\n    "j": Any<Number>,\n');
  expect(message).toContain('\n-   "k": Any<Number>,\n');
  expect(message).toContain('\n+   "k": "s",\n');
  expect(message).toContain("- Expected  - 3\n+ Received  + 3");
  expect(received).toEqual({ j: 2, k: "s", below: { n: 1, m: "x" } });
  expect(typeof received.j).toBe("number");
  expect(typeof received.below.n).toBe("number");
});

test("matchers that do not match still fail", () => {
  expect(() => expect({ j: "2" }).toMatchInlineSnapshot({ j: expect.any(Number) }, `""`)).toThrow();
});
