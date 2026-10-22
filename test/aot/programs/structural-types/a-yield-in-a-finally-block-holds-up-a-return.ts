function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function* stubborn(label: string): Generator<number, string, string> {
  let kept = "nothing";
  try {
    kept = yield 1;
    console.log(label + ": after the first yield " + text(kept));
    kept = yield 2;
    return "try " + kept;
  } finally {
    console.log(label + ": finally begins with " + text(kept));
    const inFinally: string = yield 100;
    console.log(label + ": finally was sent " + text(inFinally));
    const second: string = yield 200;
    console.log(label + ": finally was sent " + text(second));
  }
}

const a = stubborn("by hand");
console.log(text(a.next()));
console.log(text(a.return("asked")));
console.log(text(a.next("one")));
console.log(text(a.next("two")));
console.log(text(a.next("three")));

const b = stubborn("return twice");
console.log(text(b.next()));
console.log(text(b.return("first")));
console.log(text(b.return("second")));
console.log(text(b.next("late")));

const c = stubborn("throw in finally");
console.log(text(c.next()));
console.log(text(c.return("asked")));
try {
  console.log(text(c.throw(new SyntaxError("thrown in"))));
} catch (error) {
  console.log("throw in finally: " + failure(error));
}
console.log(text(c.next("late")));

const d = stubborn("break");
const hidden: Iterable<number> = d;
for (const n of hidden) {
  console.log("break: for-of got " + n);
  break;
}
console.log("break: the generator is still alive");
console.log(text(d.next("after the loop")));
console.log(text(d.next("and again")));
console.log(text(d.next("and once more")));

const e = stubborn("destructuring");
const alsoHidden: Iterable<number> = e;
const [first] = alsoHidden;
console.log("destructuring: got " + first);
console.log(text(e.next("after the pattern")));
console.log(text(e.next("and again")));

const f = stubborn("normal end");
console.log(text(f.next()));
console.log(text(f.next("x")));
console.log(text(f.next("y")));
console.log(text(f.next("z")));
console.log(text(f.next("w")));
console.log(text(f.next("v")));
