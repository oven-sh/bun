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

class Meters {
  value: number = 5;
  unit: string = "m";
  text(): string {
    return this.value + this.unit;
  }
  double(): number {
    return this.value * 2;
  }
}
class Feet {
  unit: string = "ft";
  scale: number = 3;
  value: number = 16;
  text(): string {
    return this.value / this.scale + this.unit;
  }
  double(): number {
    return this.value * 2 * this.scale;
  }
}

function honest(x: Meters | Feet): string {
  return x.text() + " " + x.double();
}
function bare(x: Meters | Feet): string {
  const { text } = x;
  return text();
}
function crossed(x: Meters | Feet, y: Meters | Feet): string {
  return x.text.call(y) + " " + x.double.call(y);
}
function maybe(x: Meters | Feet | undefined): string {
  const f = x?.text;
  return f === undefined ? "nothing to call" : f.call(x);
}
function maybeBare(x: Meters | Feet | undefined): string {
  const f = x?.text;
  return f === undefined ? "nothing to call" : f();
}
class Holder {
  inner: Meters | Feet = new Meters();
  get unbound(): () => string {
    return this.inner.text;
  }
  get bound(): () => string {
    return this.inner.text.bind(this.inner);
  }
  value: number = 1000;
  unit: string = "holder";
}

const m = new Meters();
const f = new Feet();
show("honest meters", () => honest(m));
show("honest feet", () => honest(f));
show("bare meters", () => bare(m));
show("bare feet", () => bare(f));
show("meters' methods on feet", () => crossed(m, f));
show("feet's methods on meters", () => crossed(f, m));
show("meters' methods on meters", () => crossed(m, new Meters()));
show("maybe: meters", () => maybe(m));
show("maybe: nothing", () => maybe(undefined));
show("maybe, bare: feet", () => maybeBare(f));
show("maybe, bare: nothing", () => maybeBare(undefined));

const holder = new Holder();
show("a getter hands out the unbound method: the holder is this", () => holder.unbound());
show("a getter hands out the bound method", () => holder.bound());
holder.inner = f;
show("after the inner one changed: unbound", () => holder.unbound());
show("after the inner one changed: bound", () => holder.bound());
show("the same function each time", () => holder.unbound === holder.unbound);
show("another function each time", () => holder.bound === holder.bound);
show("methods of two instances are one function", () => m.text === new Meters().text);
show("methods of two classes are two functions", () => new Set<unknown>([m.text, f.text]).size);

let letters = 0;
for (let i = 0; i < 2000; i++) letters += honest(i % 2 === 0 ? m : f).length;
show("2000 honest calls", () => letters);
show("then crossed", () => crossed(m, f));
