import { describe, expect, test } from "bun:test";
const MAP_SIZE = 918 * 4;

describe("toEqual on a large Map", () => {
  function* genpairs() {
    for (let i = 0; i < MAP_SIZE; i++) {
      yield ["k" + i, "v" + i] as const;
    }
  }

  for (let MapClass of [
    Map,
    class CustomMap extends Map {
      abc: number = 123;

      // @ts-expect-error
      constructor(iterable) {
        // @ts-expect-error
        super(iterable);
      }
    },
  ] as const) {
    test(MapClass.name, () => {
      // @ts-expect-error
      const x = new MapClass<any, any>(genpairs());
      // @ts-expect-error
      const y = new MapClass<any, any>(genpairs());

      expect(x).toEqual(y);
      x.set("not-okay", 1);
      y.set("okay", 1);

      expect(x).not.toEqual(y);

      x.delete("not-okay");
      x.set("okay", 1);

      expect(x).toEqual(y);

      x.set("okay", 2);
      expect(x).not.toEqual(y);
    });
  }
});

describe("toEqual on a large Set", () => {
  function* genvalues() {
    for (let i = 0; i < MAP_SIZE; i++) {
      yield "v" + i;
    }
  }
  for (let SetClass of [
    Set,
    class CustomSet extends Set {
      constructor(iterable: any) {
        super(iterable);
        this.abc = 123;
      }
      abc: any;
    },
  ]) {
    test(SetClass.name, () => {
      const x = new SetClass(genvalues());
      const y = new SetClass(genvalues());

      expect(x).toEqual(y);
      x.add("not-okay");
      y.add("okay");

      expect(x).not.toEqual(y);

      x.delete("not-okay");
      x.add("okay");

      expect(x).toEqual(y);
    });
  }
});
