function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

function* numbers(): Generator<number, void, void> {
  yield 1;
  yield 2;
}

function* others(): Generator<number, void, void> {
  yield 7;
}

function report(label: string): void {
  attempt(label + ", typeof next", () => typeof numbers().next);
  attempt(label + ", next", () => numbers().next());
  attempt(label + ", for-of", () => {
    let sum = 0;
    for (const n of numbers()) sum += n;
    return sum;
  });
  attempt(label + ", spread", () => [...numbers()]);
  attempt(label + ", instanceof", () => numbers() instanceof numbers);
  attempt(label + ", instanceof Iterator", () => numbers() instanceof Iterator);
  attempt(label + ", tag", () => Object.prototype.toString.call(numbers()));
  attempt(label + ", borrowed next", () => others().next.call(numbers()));
}

let warm = 0;
for (let i = 0; i < 2000; i++) for (const n of numbers()) warm += n;
console.log("2000 loops: " + warm);

const view: { prototype: unknown } = numbers;
const original: object = Object(view.prototype);
report("untouched");

Reflect.set(original, "extra", 5);
attempt("a member added to the prototype is inherited", () => "extra" in numbers());
Reflect.deleteProperty(original, "extra");

const made = numbers();
view.prototype = {};
report("an empty object");
attempt("one made before the change still works", () => [...made]);

view.prototype = null;
report("null");

view.prototype = 5;
report("a number");

view.prototype = others.prototype;
report("another generator function's");
attempt("instanceof the other", () => numbers() instanceof others);

view.prototype = {
  next(): IteratorResult<number, void> {
    return { done: true, value: undefined };
  },
  [Symbol.iterator](): unknown {
    return this;
  },
};
report("an object with its own next");

view.prototype = Object.create(original, {
  next: {
    value(): IteratorResult<number, void> {
      return { done: true, value: undefined };
    },
  },
});
report("a child of the original that hides next");

view.prototype = original;
report("the original again");

attempt("constructing a generator function", () => Reflect.construct(numbers, []));
