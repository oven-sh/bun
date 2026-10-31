// Run by diffexample.test.ts: `bun diff-array-holes.fixture.ts <group>`.
// Prints the message of each failing matcher. Nothing here may take time or
// memory that follows the `length` an array claims.
import { expect, mock } from "bun:test";

function report(name: string, fn: () => void) {
  let message = "did not throw";
  try {
    fn();
  } catch (e) {
    message = (e as Error).message;
  }
  console.log(`## ${name}\n${message}\n`);
}

/** `count` holes, then `tail`. */
function holes(count: number, ...tail: unknown[]): unknown[] {
  const array: unknown[] = [];
  array.length = count;
  array.push(...tail);
  return array;
}

// With one more element the length is 2**32 - 1, the longest an array can claim.
const most = 2 ** 32 - 2;

/** What a failing `expect(array).toEqual(0)` prints for `array`, from the array's own keys. */
function model(array: unknown[]): string {
  const lines: string[] = [];
  let next = 0;
  const holesUpTo = (index: number) => {
    const run = index - next;
    if (run > 8) lines.push(`${run} x empty items,`);
    else for (let i = 0; i < run; i++) lines.push("undefined,");
  };
  for (const key of Object.keys(array)) {
    const index = Number(key);
    holesUpTo(index);
    lines.push(`${JSON.stringify(array[index])},`);
    next = index + 1;
  }
  holesUpTo(array.length);
  return ["- 0", "+ [", ...lines.map(line => `+   ${line}`), "+ ]"].join("\n");
}

const groups: Record<string, () => void> = {
  runs() {
    report("8 holes keep one line each", () => expect(holes(8, 1)).toEqual(holes(8, 2)));
    report("9 holes are one line", () => expect(holes(9, 1)).toEqual(holes(9, 2)));
    report("[1, , 3] is unchanged", () => expect([1, , 3]).toEqual([1, 2, 3]));
    report("leading, middle and trailing runs", () => {
      const array: unknown[] = [];
      array[20] = "a";
      array[51] = "b";
      array.length = 92;
      expect(array).toEqual(0);
    });
    report("nested", () => expect({ list: [holes(12, 1)] }).toEqual({ list: [holes(12, 2)] }));
    report("a long run against explicit undefined", () =>
      expect(holes(9, 1)).toStrictEqual([...Array.from({ length: 9 }, () => undefined), 1]),
    );
    report("class extends Array", () => {
      class List extends Array {}
      const list = new List();
      list.length = 100;
      list[50] = "x";
      expect(list).toEqual(0);
    });
    report("frozen", () => expect(Object.freeze(holes(10, 1))).toEqual(0));
    report("circular", () => {
      const array = holes(10);
      array.push(array);
      expect(array).toEqual(0);
    });
    report("an own index accessor runs once", () => {
      let reads = 0;
      const array = holes(20);
      Object.defineProperty(array, 4, { get: () => ++reads, enumerable: true });
      expect(array).toEqual(0);
    });
    report("indices in the sparse map", () => {
      const array: unknown[] = [];
      for (let i = 0; i < 5; i++) array[1_000_000 + i * 20] = i;
      expect(array).toEqual(0);
    });
    // `Promise {}` starts a new line once the line so far counts more than 80
    // columns. One line for 9 holes has to count like 9 `undefined,` lines.
    report("a Promise after 9 holes", () => expect(holes(9, Promise.resolve(1))).toEqual(0));
    report("a Promise after 9 undefined", () =>
      expect([...Array.from({ length: 9 }, () => undefined), Promise.resolve(1)]).toEqual(0),
    );
  },

  // One array per way JSC can store elements. Each is checked against what its own keys say.
  storage() {
    const shapes: Record<string, () => unknown[]> = {
      "int32": () => {
        const array: unknown[] = [1, 2];
        array[30] = 3;
        return array;
      },
      "double": () => {
        const array: unknown[] = [1.5, 2.5];
        array[30] = 3.5;
        return array;
      },
      "contiguous": () => {
        const array: unknown[] = ["a", "b"];
        array[30] = "c";
        return array;
      },
      "no elements": () => holes(50),
      "array storage, in the vector": () => {
        const array: unknown[] = [1];
        array[20] = 2;
        array.length = most + 1;
        return array;
      },
      "array storage, in the sparse map": () => {
        const array: unknown[] = [];
        array[1_000_000] = 1;
        array[1_000_005] = 2;
        array[1_000_030] = 3;
        return array;
      },
      "array storage, in both": () => {
        const array: unknown[] = [1];
        array[20] = 2;
        array[25] = 3;
        array[1_000_000] = 4;
        array.length = 2_000_000;
        return array;
      },
      "frozen": () => {
        const array: unknown[] = [1];
        array[20] = 2;
        return Object.freeze(array);
      },
      "runs of 8 and 9": () => {
        const array: unknown[] = [];
        array[8] = "after 8";
        array[18] = "after 9";
        array.length = 28;
        return array;
      },
    };
    for (const [name, make] of Object.entries(shapes)) {
      const array = make();
      let printed = "did not throw";
      try {
        expect(array).toEqual(0);
      } catch (e) {
        const lines = (e as Error).message.split("\n");
        printed = lines.slice(lines.indexOf("- 0"), lines.lastIndexOf("+ ]") + 1).join("\n");
      }
      const expected = model(array);
      console.log(`## ${name}\n${printed === expected ? "as its own keys say" : `printed:\n${printed}\nown keys say:\n${expected}`}\n`);
    }
  },

  // Each input lets the comparison answer at once, so only the printer's cost shows.
  longest() {
    report("toEqual, index 0 differs", () => {
      const a = [1];
      a.length = most + 1;
      const b = [2];
      b.length = most + 1;
      expect(a).toEqual(b);
    });
    report("toEqual, other type", () => expect(holes(most, 1)).toEqual(0));
    report("not.toEqual", () => {
      const array = holes(most, 1);
      expect(array).not.toEqual(array);
    });
    report("toStrictEqual, other length", () => expect(new Array(most + 1)).toStrictEqual([]));
    report("toMatchObject", () => expect({ a: holes(most, 1) }).toMatchObject({ a: 0 }));
    report("toHaveProperty", () => expect({ a: holes(most, 1) }).toHaveProperty("a", 0));
    report("toHaveBeenCalledWith", () => {
      const fn = mock((..._: unknown[]) => {});
      fn(holes(most, 1));
      expect(fn).toHaveBeenCalledWith(0);
    });
    report("toHaveBeenLastCalledWith", () => {
      const fn = mock((..._: unknown[]) => {});
      fn(holes(most, 1));
      expect(fn).toHaveBeenLastCalledWith(0);
    });
    report("toHaveBeenNthCalledWith", () => {
      const fn = mock((..._: unknown[]) => {});
      fn(holes(most, 1));
      expect(fn).toHaveBeenNthCalledWith(1, 0);
    });
    report("matcherHint", () => {
      expect.extend({
        toBeZero(received: unknown) {
          return { pass: false, message: () => this.utils.matcherHint("toBeZero", received, 0) };
        },
      });
      // @ts-expect-error added by expect.extend above
      expect(holes(most, 1)).toBeZero();
    });
    report("frozen class extends Array", () => {
      class List extends Array {}
      const list = new List();
      list.length = most + 1;
      list[7] = "x";
      expect(Object.freeze(list)).toEqual(0);
    });
    report("an index accessor that throws", () => {
      const array = holes(most + 1);
      Object.defineProperty(array, 100, {
        get() {
          throw new Error("thrown by the accessor");
        },
      });
      expect({ nested: [array] }).toEqual(0);
    });
  },

  // Printing an element can run user code that changes the array being printed.
  // The sparse indices are copied once, before the first of them is read. An
  // index stored after that stays inside a run of holes. Nothing past the
  // length read at the start is printed.
  mutation() {
    report("an accessor stores a later index", () => {
      const array = holes(1_000_000);
      Object.defineProperty(array, 10, {
        enumerable: true,
        get() {
          array[500_000] = "late";
          return "getter";
        },
      });
      expect(array).toEqual(0);
    });
    report("a Proxy element stores a later index", () => {
      const array = holes(1_000_000);
      array[200_000] = new Proxy(
        {},
        {
          ownKeys() {
            array[500_000] = "late";
            return [];
          },
        },
      );
      array[300_000] = "early";
      expect(array).toEqual(0);
    });
    report("an accessor deletes a later index", () => {
      const array = holes(1_000_000);
      array[300_000] = "deleted";
      array[600_000] = "kept";
      Object.defineProperty(array, 10, {
        enumerable: true,
        get() {
          delete array[300_000];
          return "getter";
        },
      });
      expect(array).toEqual(0);
    });
    report("an accessor swaps one later index for another", () => {
      const array = holes(1_000_000);
      array[300_000] = "deleted";
      array[600_000] = "kept";
      Object.defineProperty(array, 10, {
        enumerable: true,
        get() {
          delete array[300_000];
          array[400_000] = "swapped in";
          return "getter";
        },
      });
      expect(array).toEqual(0);
    });
    report("an accessor shrinks the array", () => {
      const array = holes(1_000_000);
      Object.defineProperty(array, 10, {
        enumerable: true,
        get() {
          array.length = 20;
          return "getter";
        },
      });
      expect(array).toEqual(0);
    });
    const storesAt = (array: unknown[], index: number) =>
      new Proxy(
        {},
        {
          ownKeys() {
            array[index] = "past the end";
            return [];
          },
        },
      );
    report("a Proxy element grows the vector past the length", () => {
      const array = holes(30);
      array[3] = storesAt(array, 40);
      expect(array).toEqual(0);
    });
    report("a Proxy element stores a sparse index past the length", () => {
      const array = holes(1_000_000);
      array[3] = storesAt(array, 2_000_000);
      expect(array).toEqual(0);
    });
  },

  // The time must follow what the array stores. A walk that reads the whole
  // sparse map again for each run of holes is quadratic, and fails this.
  scale() {
    const count = 20_000;
    const sparse: unknown[] = [];
    for (let i = 0; i < count; i++) sparse[1_000_000 + i * 20] = i;
    const dense = Array.from({ length: count }, (_, i) => i);
    const time = (array: unknown[]) => {
      const start = performance.now();
      try {
        expect(array).toEqual(0);
      } catch {}
      return performance.now() - start;
    };
    time(dense);
    console.log(JSON.stringify({ baseline: time(dense), ms: time(sparse) }));
  },

  // Own process: an index on Array.prototype changes how JSC reads every array for good.
  prototype() {
    Array.prototype[1] = "proto";
    report("an index only Array.prototype has is a hole", () => {
      const array = [0];
      array.length = most + 1;
      expect(array).toEqual(0);
    });
  },
};

// If a run of holes is not one line, the groups need gigabytes before the kill switch fires.
let nineHoles = "";
try {
  expect(holes(9)).toEqual(0);
} catch (e) {
  nineHoles = (e as Error).message;
}
if (!nineHoles.includes("9 x empty items")) {
  console.log(`A run of 9 holes is not one line:\n${nineHoles}`);
  process.exit(1);
}

groups[process.argv[2]]();
