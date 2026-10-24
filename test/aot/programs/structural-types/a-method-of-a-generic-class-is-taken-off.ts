function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

class Box<T> {
  value: T;
  reads: number = 0;
  constructor(value: T) {
    this.value = value;
  }
  get(): T {
    this.reads++;
    return this.value;
  }
  peek(): T {
    return this.value;
  }
  set(value: T): void {
    this.value = value;
  }
  map<U>(f: (value: T) => U): Box<U> {
    return new Box(f(this.value));
  }
}

const numbers = new Box(5);
const strings = new Box("five");
const lists = new Box([1, 2]);

show("honest", () => numbers.get() + strings.get().length + lists.get().length);
show("bare peek of a number", () => (0, numbers.peek)());
show("bare get of a number", () => (0, numbers.get)());
show("bare set", () => (0, numbers.set)(6));
show("bare map", () => (0, numbers.map)(n => n + 1));

const peekNumber = numbers.peek;
show("a number box's peek on a string box", () => peekNumber.call(strings));
show("plus one", () => peekNumber.call(strings) + 1);
show("a string box's peek on a number box: length", () => strings.peek.call(numbers).length);
show("a list box's peek on a number box: length", () => lists.peek.call(numbers).length);
show("a number box's set on a string box", () => numbers.set.call(strings, 7));
show("the string box now holds", () => typeof strings.value + " " + strings.value);
show("its length", () => strings.get().length);
show("a look-alike", () => numbers.peek.call({ value: 50, reads: 0 }) + 1);
show("a look-alike of another kind", () => numbers.peek.call({ value: "fifty", reads: 0 }) + 1);
show("a look-alike without reads: get", () => {
  const like = { value: 1 };
  return numbers.get.call(like) + " " + JSON.stringify(like);
});
show("map on a look-alike", () => numbers.map.call({ value: 3 }, n => String(n)).value);
show("reads", () => numbers.reads + " " + strings.reads + " " + lists.reads);

const getters: (() => number)[] = [numbers.peek, numbers.peek.bind(numbers), () => numbers.peek()];
show("three ways in one array, called by value", () => {
  const out: string[] = [];
  for (const f of getters) {
    try {
      out.push(String(f()));
    } catch (error) {
      out.push("threw");
    }
  }
  return out.join();
});
