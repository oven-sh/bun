import { Dequeue } from "bun:internal-for-testing";
import { beforeEach, describe, expect, it } from "bun:test";

/**
 * Implements the same API as {@link Dequeue} but uses a simple list as the
 * backing store.
 *
 * Used to check expected behavior.
 */
class DequeueList<T> {
  private _list: T[];

  constructor() {
    this._list = [];
  }

  size(): number {
    return this._list.length;
  }

  isEmpty(): boolean {
    return this.size() == 0;
  }

  isNotEmpty(): boolean {
    return this.size() > 0;
  }

  shift(): T | undefined {
    return this._list.shift();
  }

  peek(): T | undefined {
    return this._list[0];
  }

  push(item: T): void {
    this._list.push(item);
  }

  toArray(fullCopy: boolean): T[] {
    return fullCopy ? this._list.slice() : this._list;
  }

  clear(): void {
    this._list = [];
  }
}

describe("Given an empty queue", () => {
  let queue: Dequeue<number>;

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
      expect(queue.size()).toBe(1);
    });

    it("is not empty", () => {
      expect(queue.isEmpty()).toBe(false);
      expect(queue.isNotEmpty()).toBe(true);
    });

    it("can be shifted out", () => {
      const el = queue.shift();
      expect(el).toBe(42);
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });
  }); // </When an element is pushed>
}); // </Given an empty queue>

describe("grow boundary conditions", () => {
  describe.each([3, 4, 16])("when %d items are pushed", n => {
    let queue: Dequeue<number>;

    beforeEach(() => {
      queue = new Dequeue();
      for (let i = 0; i < n; i++) {
        queue.push(i);
      }
    });

    it(`has a size of ${n}`, () => {
      expect(queue.size()).toBe(n);
    });

    it("is not empty", () => {
      expect(queue.isEmpty()).toBe(false);
      expect(queue.isNotEmpty()).toBe(true);
    });

    it(`can shift() ${n} times`, () => {
      for (let i = 0; i < n; i++) {
        expect(queue.peek()).toBe(i);
        expect(queue.shift()).toBe(i);
      }
      expect(queue.size()).toBe(0);
      expect(queue.shift()).toBe(undefined);
    });

    it("toArray() returns [0..n-1]", () => {
      // same as repeated push() but only allocates once
      var expected = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        expected[i] = i;
      }
      expect(queue.toArray()).toEqual(expected);
    });
  });
}); // </grow boundary conditions>

describe("adding and removing items", () => {
  let queue: Dequeue<number>;
  let expected: DequeueList<number>;

  describe("when 10k items are pushed", () => {
    beforeEach(() => {
      queue = new Dequeue();
      expected = new DequeueList();

      for (let i = 0; i < 10_000; i++) {
        queue.push(i);
        expected.push(i);
      }
    });

    it("has a size of 10000", () => {
      expect(queue.size()).toBe(10_000);
      expect(expected.size()).toBe(10_000);
    });

    describe("when 10 items are shifted", () => {
      beforeEach(() => {
        for (let i = 0; i < 10; i++) {
          expect(queue.shift()).toBe(expected.shift());
        }
      });

      it("has a size of 9990", () => {
        expect(queue.size()).toBe(9990);
        expect(expected.size()).toBe(9990);
      });
    });
  }); // </when 10k items are pushed>

  describe("when 1k items are pushed, then removed", () => {
    beforeEach(() => {
      queue = new Dequeue();
      expected = new DequeueList();

      for (let i = 0; i < 1_000; i++) {
        queue.push(i);
        expected.push(i);
      }
      expect(queue.size()).toBe(1_000);

      while (queue.isNotEmpty()) {
        expect(queue.shift()).toBe(expected.shift());
      }
    });

    it("is now empty", () => {
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBeTrue();
      expect(queue.isNotEmpty()).toBeFalse();
    });

    it("when new items are added, the backing list is resized", () => {
      for (let i = 0; i < 10_000; i++) {
        queue.push(i);
        expected.push(i);
        expect(queue.size()).toBe(expected.size());
        expect(queue.peek()).toBe(expected.peek());
        expect(queue.isEmpty()).toBeFalse();
        expect(queue.isNotEmpty()).toBeTrue();
      }
    });
  }); // </when 1k items are pushed, then removed>

  it("pushing and shifting a lot of items affects the size and backing list correctly", () => {
    queue = new Dequeue();
    expected = new DequeueList();

    for (let i = 0; i < 15_000; i++) {
      queue.push(i);
      expected.push(i);
      expect(queue.size()).toBe(expected.size());
      expect(queue.peek()).toBe(expected.peek());
      expect(queue.isEmpty()).toBeFalse();
      expect(queue.isNotEmpty()).toBeTrue();
    }

    // shift() shrinks the backing array when tail > 10,000 and the list is
    // shrunk too far (tail <= list.length >>> 2)
    for (let i = 0; i < 10_000; i++) {
      expect(queue.shift()).toBe(expected.shift());
      expect(queue.size()).toBe(expected.size());
    }

    for (let i = 0; i < 5_000; i++) {
      queue.push(i);
      expected.push(i);
      expect(queue.size()).toBe(expected.size());
      expect(queue.peek()).toBe(expected.peek());
      expect(queue.isEmpty()).toBeFalse();
      expect(queue.isNotEmpty()).toBeTrue();
    }
  }); // </pushing a lot of items affects the size and backing list correctly>
}); // </adding and removing items>
