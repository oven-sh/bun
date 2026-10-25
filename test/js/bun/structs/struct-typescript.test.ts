import { describe, expect, test } from "bun:test";

describe("struct in TypeScript", () => {
  test("typed fields, generics-free methods and extends", () => {
    struct Point {
      x: number;
      y: number;
      constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
      }
      dist(other: Point): number {
        return Math.hypot(this.x - other.x, this.y - other.y);
      }
    }
    struct Point3 extends Point {
      z: number;
      constructor(x: number, y: number, z: number) {
        super(x, y);
        this.z = z;
      }
    }
    const a = new Point(0, 0);
    const b = new Point3(3, 4, 5);
    expect(a.dist(b)).toBe(5);
    expect(Object.keys(b)).toEqual(["x", "y", "z"]);
  });

  test("optional and definite fields", () => {
    struct Node {
      value?: number;
      next!: Node | undefined;
    }
    const n = new Node();
    expect(n.value).toBeUndefined();
    expect(n.next).toBeUndefined();
    expect(Object.keys(n)).toEqual(["value", "next"]);
  });

  test("shared struct with annotations", () => {
    shared struct Stats {
      hits: number;
      label: string;
    }
    const s = new Stats();
    s.hits = 1;
    s.label = "ok";
    expect(Atomics.load(s, "hits")).toBe(1);
    expect(Reflect.canBeShared(s)).toBe(true);
  });

  test("exported structs work across modules", async () => {
    const mod = await import("./fixtures/exported-struct");
    const p = new mod.Pair(1, 2);
    expect(p.sum()).toBe(3);
    expect(Object.isExtensible(p)).toBe(false);
  });
});
