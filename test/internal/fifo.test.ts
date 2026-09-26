import { Dequeue } from "bun:internal-for-testing";
import { beforeEach, describe, expect, it } from "bun:test";

// Dequeue is a ring buffer. `_list.length` is its capacity, a power of two
// that starts at 4, and `_capacityMask` is `capacity - 1`. The push that
// fills the list doubles it. shift() only halves the list when the new head
// is 0 or 1, the tail is past 10000 and the items left fit in a quarter of
// the list, so a list shorter than 65536 never shrinks.
//
// The tests below avoid expect() calls inside loops. Each expect() is slow in
// debug builds and runs a GC in CI, so per-iteration checks are collected
// into arrays and compared once.

/** The Dequeue API the tests use. `Dequeue` itself has no type declaration. */
interface Queue {
  size(): number;
  isEmpty(): boolean;
  isNotEmpty(): boolean;
  peek(): number | undefined;
  shift(): number | undefined;
  push(item: number): void;
  toArray(): number[];
  _list: (number | undefined)[];
  _capacityMask: number;
}

/** `[start, start + 1, ..., end - 1]` */
function range(start: number, end: number): number[] {
  const result = new Array<number>(end - start);
  for (let i = start; i < end; i++) result[i - start] = i;
  return result;
}

/** The capacity of a queue that held at most `maxSize` items at once and never shrank. */
function capacityFor(maxSize: number): number {
  let capacity = 4;
  while (capacity <= maxSize) capacity *= 2;
  return capacity;
}

/** Everything observable about `queue`, so that one toEqual() checks all of it. */
function stateOf(queue: Queue) {
  return {
    size: queue.size(),
    isEmpty: queue.isEmpty(),
    isNotEmpty: queue.isNotEmpty(),
    peek: queue.peek(),
    items: queue.toArray(),
    capacity: queue._list.length,
    capacityMask: queue._capacityMask,
  };
}

/** The state of a queue that holds `items` in a backing list of length `capacity`. */
function stateWith(items: number[], capacity: number) {
  return {
    size: items.length,
    isEmpty: items.length === 0,
    isNotEmpty: items.length > 0,
    peek: items[0],
    items,
    capacity,
    capacityMask: capacity - 1,
  };
}

function pushRange(queue: Queue, start: number, end: number): void {
  for (let i = start; i < end; i++) queue.push(i);
}

/** Calls peek() and then shift() `count` times. Returns what each call returned, in order. */
function shiftMany(queue: Queue, count: number) {
  const peeked = new Array<number | undefined>(count);
  const shifted = new Array<number | undefined>(count);
  for (let i = 0; i < count; i++) {
    peeked[i] = queue.peek();
    shifted[i] = queue.shift();
  }
  return { peeked, shifted };
}

/** What shiftMany() returns when it takes `items` out in order. */
function shiftedInOrder(items: number[]) {
  return { peeked: items, shifted: items };
}

describe("Given an empty queue", () => {
  let queue: Queue;

  beforeEach(() => {
    queue = new Dequeue();
  });

  it("has a size of 0", () => {
    expect(queue.size()).toBe(0);
  });

  it("is empty", () => {
    expect(queue.isEmpty()).toBe(true);
    expect(queue.isNotEmpty()).toBe(false);
  });

  it("shift() returns undefined", () => {
    expect(queue.shift()).toBe(undefined);
    expect(queue.size()).toBe(0);
  });

  it("peek() returns undefined", () => {
    expect(queue.peek()).toBe(undefined);
    expect(queue.size()).toBe(0);
  });

  it("has an initial capacity of 4", () => {
    expect(queue._list.length).toBe(4);
    expect(queue._capacityMask).toBe(3);
  });

  it("toArray() returns an empty array", () => {
    expect(queue.toArray()).toEqual([]);
  });

  describe("When an element is pushed", () => {
    beforeEach(() => {
      queue.push(42);
    });

    it("has a size of 1", () => {
      expect(queue.size()).toBe(1);
    });

    it("can be peeked without removing it", () => {
      expect(queue.peek()).toBe(42);
      expect(stateOf(queue)).toEqual(stateWith([42], 4));
    });

    it("is not empty", () => {
      expect(queue.isEmpty()).toBe(false);
      expect(queue.isNotEmpty()).toBe(true);
    });

    it("can be shifted out", () => {
      expect(queue.shift()).toBe(42);
      expect(stateOf(queue)).toEqual(stateWith([], 4));
    });
  }); // </When an element is pushed>
}); // </Given an empty queue>

describe("grow boundary conditions", () => {
  // 3 and 7 items are one push short of a grow. The 4th, 8th and 16th push
  // fill the list and grow it. 1000 items cross eight grows.
  describe.each([
    [3, 4],
    [4, 8],
    [7, 8],
    [8, 16],
    [16, 32],
    [1000, 1024],
  ])("when %d items are pushed", (n, capacity) => {
    let queue: Queue;

    beforeEach(() => {
      queue = new Dequeue();
      pushRange(queue, 0, n);
    });

    it(`has a size of ${n}`, () => {
      expect(queue.size()).toBe(n);
    });

    it("is not empty", () => {
      expect(queue.isEmpty()).toBe(false);
      expect(queue.isNotEmpty()).toBe(true);
    });

    it(`has a capacity of ${capacity}`, () => {
      expect(queue._list.length).toBe(capacity);
      expect(queue._capacityMask).toBe(capacity - 1);
    });

    it("toArray() returns [0..n-1]", () => {
      expect(queue.toArray()).toEqual(range(0, n));
    });

    it(`can shift() ${n} times`, () => {
      expect(shiftMany(queue, n)).toEqual(shiftedInOrder(range(0, n)));
      // empty again, but shift() does not shrink a list this small
      expect(stateOf(queue)).toEqual(stateWith([], capacity));
      expect(queue.shift()).toBe(undefined);
    });
  });

  it("the push that fills the list doubles it", () => {
    const queue: Queue = new Dequeue();
    const capacities: number[] = [];
    for (let i = 0; i < 20; i++) {
      queue.push(i);
      capacities.push(queue._list.length);
    }
    expect(capacities).toEqual([4, 4, 4, 8, 8, 8, 8, 16, 16, 16, 16, 16, 16, 16, 16, 32, 32, 32, 32, 32]);
    expect(queue._capacityMask).toBe(31);
  });
}); // </grow boundary conditions>

describe("adding and removing items", () => {
  let queue: Queue;

  describe("when 10k items are pushed", () => {
    beforeEach(() => {
      queue = new Dequeue();
      pushRange(queue, 0, 10_000);
    });

    it("has a size of 10000", () => {
      expect(stateOf(queue)).toEqual(stateWith(range(0, 10_000), 16384));
    });

    describe("when 10 items are shifted", () => {
      let taken: ReturnType<typeof shiftMany>;

      beforeEach(() => {
        taken = shiftMany(queue, 10);
      });

      it("has a size of 9990", () => {
        expect(taken).toEqual(shiftedInOrder(range(0, 10)));
        expect(stateOf(queue)).toEqual(stateWith(range(10, 10_000), 16384));
      });
    });
  }); // </when 10k items are pushed>

  describe("when 1k items are pushed, then removed", () => {
    let taken: ReturnType<typeof shiftMany>;

    beforeEach(() => {
      queue = new Dequeue();
      pushRange(queue, 0, 1_000);
      taken = shiftMany(queue, 1_000);
    });

    it("is now empty", () => {
      expect(taken).toEqual(shiftedInOrder(range(0, 1_000)));
      // shift() does not shrink a list this small
      expect(stateOf(queue)).toEqual(stateWith([], 1024));
      expect(queue.shift()).toBe(undefined);
    });

    it("when new items are added, the backing list is resized", () => {
      // head and tail both sit at slot 1000 of the 1024-slot list, so the
      // 24th push wraps tail around to slot 0.
      pushRange(queue, 0, 500);
      expect(stateOf(queue)).toEqual(stateWith(range(0, 500), 1024));

      // The 1024th push fills the list. Growing it moves the wrapped items so
      // that head is back at slot 0. The 2048th push grows it again.
      const capacities: number[] = [];
      for (let i = 500; i < 3_000; i++) {
        queue.push(i);
        capacities.push(queue._list.length);
      }
      // The list never shrank below the 1024 slots the first 1000 items needed.
      expect(capacities).toEqual(range(501, 3_001).map(size => capacityFor(Math.max(size, 1_000))));
      expect(stateOf(queue)).toEqual(stateWith(range(0, 3_000), 4096));
    });
  }); // </when 1k items are pushed, then removed>

  it("pushing and shifting a lot of items affects the size and backing list correctly", () => {
    queue = new Dequeue();

    pushRange(queue, 0, 1_500);
    expect(stateOf(queue)).toEqual(stateWith(range(0, 1_500), 2048));

    // shift() does not shrink the list
    expect(shiftMany(queue, 1_000)).toEqual(shiftedInOrder(range(0, 1_000)));
    expect(stateOf(queue)).toEqual(stateWith(range(1_000, 1_500), 2048));

    // tail wraps around to slot 452 while head stays at slot 1000
    pushRange(queue, 1_500, 2_500);
    expect(stateOf(queue)).toEqual(stateWith(range(1_000, 2_500), 2048));

    // the items come back out in order across the wrap
    expect(shiftMany(queue, 1_500)).toEqual(shiftedInOrder(range(1_000, 2_500)));
    expect(stateOf(queue)).toEqual(stateWith([], 2048));
    expect(queue.shift()).toBe(undefined);
  }); // </pushing and shifting a lot of items affects the size and backing list correctly>

  it("wraps around the ring many times without growing", () => {
    queue = new Dequeue();
    pushRange(queue, 0, 12);
    expect(stateOf(queue)).toEqual(stateWith(range(0, 12), 16));

    // 12 items in 16 slots: head and tail each go around the ring 62 times
    const shifted: (number | undefined)[] = [];
    const sizeAndCapacity: number[][] = [];
    for (let i = 0; i < 1_000; i++) {
      shifted.push(queue.shift());
      queue.push(12 + i);
      sizeAndCapacity.push([queue.size(), queue._list.length]);
    }
    expect(shifted).toEqual(range(0, 1_000));
    expect(sizeAndCapacity).toEqual(new Array(1_000).fill([12, 16]));
    expect(stateOf(queue)).toEqual(stateWith(range(1_000, 1_012), 16));
  });

  it("grows while wrapped when each round pushes two items and shifts one", () => {
    queue = new Dequeue();
    const shifted: (number | undefined)[] = [];
    const capacities: number[] = [];
    for (let i = 0; i < 2_000; i++) {
      queue.push(2 * i);
      shifted.push(queue.shift());
      queue.push(2 * i + 1);
      capacities.push(queue._list.length);
    }
    // Round i leaves i + 1 items behind. Every grow happens while head is
    // past slot 0, so each one copies the wrapped items to the front.
    expect(shifted).toEqual(range(0, 2_000));
    expect(capacities).toEqual(range(1, 2_001).map(capacityFor));
    expect(stateOf(queue)).toEqual(stateWith(range(2_000, 4_000), 2048));
  });

  it("shift() halves the list once the items left fit in a quarter of it", () => {
    // shift() shrinks only when the new head is 0 or 1, tail > 10000 and
    // tail <= capacity / 4. That needs a list of at least 65536 slots.
    queue = new Dequeue();
    pushRange(queue, 0, 32_768);
    expect(stateOf(queue)).toEqual(stateWith(range(0, 32_768), 65536));

    // head moves to slot 22768. tail stays at 32768, more than a quarter.
    expect(shiftMany(queue, 22_768)).toEqual(shiftedInOrder(range(0, 22_768)));
    expect(stateOf(queue)).toEqual(stateWith(range(22_768, 32_768), 65536));

    // tail wraps around to slot 10001
    pushRange(queue, 32_768, 75_537);
    expect(stateOf(queue)).toEqual(stateWith(range(22_768, 75_537), 65536));

    // head moves to slot 65535, the last one. No shrink yet.
    expect(shiftMany(queue, 42_767)).toEqual(shiftedInOrder(range(22_768, 65_535)));
    expect(stateOf(queue)).toEqual(stateWith(range(65_535, 75_537), 65536));

    // This shift wraps head to slot 0 and halves the list. The 10001 items
    // left sit in slots 0..10000 and survive the cut.
    expect(queue.shift()).toBe(65_535);
    expect(stateOf(queue)).toEqual(stateWith(range(65_536, 75_537), 32768));

    // 10001 items do not fit in a quarter of 32768 slots, so no second cut.
    expect(queue.shift()).toBe(65_536);
    expect(stateOf(queue)).toEqual(stateWith(range(65_537, 75_537), 32768));

    expect(shiftMany(queue, 10_000)).toEqual(shiftedInOrder(range(65_537, 75_537)));
    expect(stateOf(queue)).toEqual(stateWith([], 32768));
    expect(queue.shift()).toBe(undefined);
  });
}); // </adding and removing items>
