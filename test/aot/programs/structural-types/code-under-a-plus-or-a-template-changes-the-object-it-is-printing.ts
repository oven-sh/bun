class Counter {
  count = 0;
  label = "counter";
  describe(): string {
    return this.label + " at " + this.count;
  }
  [Symbol.toPrimitive](hint: string): string {
    this.count++;
    if (this.count === 2) this.describe = () => "covered at " + this.count;
    if (this.count === 4) Reflect.deleteProperty(this, "describe");
    return hint + " " + this.count;
  }
}

function around(c: Counter): string {
  return c.describe() + " | " + `${c}` + " | " + c.describe();
}

function inOneExpression(c: Counter): string {
  return c.count + " " + c + " " + c.count + " " + c + " " + c.count;
}

function inOneTemplate(c: Counter): string {
  return `${c.count} ${c} ${c.count} ${c.describe()} ${c} ${c.describe()}`;
}

const a = new Counter();
for (let i = 0; i < 5; i++) console.log("around, round " + i + ": " + around(a));

console.log("one expression: " + inOneExpression(new Counter()));
console.log("one template: " + inOneTemplate(new Counter()));

class Shrinking {
  items: number[] = [1, 2, 3, 4];
  toString(): string {
    this.items.pop();
    return "left " + this.items.length;
  }
}

function lengths(s: Shrinking): string {
  const list = s.items;
  return list.length + " " + s + " " + list.length + " " + s + " " + list.length + " " + list[3] + " " + list[2] + " " + list[1];
}

console.log("an array shrinks under the plus: " + lengths(new Shrinking()));

class Retyping {
  value: number | string = 1;
  valueOf(): number {
    this.value = typeof this.value === "number" ? "text" : 2;
    return 0;
  }
}

function retype(r: Retyping): string {
  if (typeof r.value === "number") {
    const zero = +r;
    return "narrowed to a number, now " + typeof r.value + " " + r.value + " " + zero;
  }
  return "a string: " + r.value;
}

const r = new Retyping();
console.log("a field changes its type under the unary plus: " + retype(r) + " | " + retype(r) + " | " + +r + " | " + retype(r));

let warm = 0;
const steady = new Counter();
steady.count = 10;
for (let i = 0; i < 2000; i++) warm += around(steady).length;
console.log("2000 rounds: " + warm + ", count " + steady.count);
const late = new Counter();
console.log("then a new one: " + around(late) + " || " + around(late) + " || " + around(late));

export {};
