interface Series {
  name: string;
  [Symbol.iterator](): Iterator<number>;
}

const log: string[] = [];

function flush(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(",") + "]");
  log.length = 0;
}

function logged(values: number[]): Iterator<number> {
  let i = 0;
  return {
    next() {
      log.push("next");
      return i < values.length ? { done: false, value: values[i++] } : { done: true, value: undefined };
    },
    return() {
      log.push("return");
      return { done: true, value: undefined };
    },
  };
}

class MethodForm {
  name = "a method of a class";
  [Symbol.iterator](): Iterator<number> {
    return logged([1, 2, 3]);
  }
}

class GeneratorForm {
  name = "a generator method";
  *[Symbol.iterator](): Generator<number> {
    try {
      yield 4;
      yield 5;
      yield 6;
    } finally {
      log.push("finally");
    }
  }
}

class FieldForm {
  name = "an arrow in a field";
  [Symbol.iterator] = (): Iterator<number> => logged([7, 8, 9]);
}

class GetterForm {
  name = "a getter";
  get [Symbol.iterator](): () => Iterator<number> {
    log.push("get iterator");
    return () => logged([10, 11, 12]);
  }
}

const literal: Series = {
  name: "a literal",
  [Symbol.iterator]: () => logged([13, 14, 15]),
};

const inherited: Series = Object.assign(Object.create(new MethodForm()), { name: "inherited" });
const borrowed: Series = { name: "an array's own iterator", [Symbol.iterator]: [16, 17, 18][Symbol.iterator].bind([16, 17, 18]) };
const list: Series = Object.assign([19, 20, 21], { name: "an array with a name" });

function sum(s: Series): number {
  let total = 0;
  for (const n of s) total += n;
  return total;
}

function firstOnly(s: Series): number {
  for (const n of s) return n;
  return -1;
}

function firstTwo(s: Series): string {
  const [a, b] = s;
  return a + "+" + b;
}

function* relay(s: Series): Generator<number> {
  yield* s;
}

const table: Series[] = [new MethodForm(), new GeneratorForm(), new FieldForm(), new GetterForm(), literal, inherited, borrowed, list];

for (const s of table) {
  flush(s.name + ", for-of", sum(s));
  flush(s.name + ", left early", firstOnly(s));
  flush(s.name + ", pattern", firstTwo(s));
  flush(s.name + ", spread", [...s].join());
  flush(s.name + ", arguments", Math.max(...s));
  flush(s.name + ", Array.from", Array.from(s, n => n * 2).join());
  flush(s.name + ", a set", new Set(s).size);
  flush(s.name + ", yield*", [...relay(s)].join());
  flush(s.name + ", own", Object.hasOwn(s, Symbol.iterator) + " " + Object.keys(s).join());
}

const honest = new MethodForm();
let total = 0;
for (let i = 0; i < 2000; i++) total += sum(honest);
log.length = 0;
console.log("2000 honest: " + total);
for (const s of table) flush("then " + s.name, sum(s));

const changing: Series = new MethodForm();
flush("before it is replaced", sum(changing));
changing[Symbol.iterator] = () => logged([100]);
flush("an own member hides the method", sum(changing));
MethodForm.prototype[Symbol.iterator] = () => logged([200]);
flush("the class's method replaced", sum(new MethodForm()) + " " + sum(inherited) + " " + sum(changing));

export {};
