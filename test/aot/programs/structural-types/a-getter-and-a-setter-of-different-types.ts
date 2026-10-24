function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Width {
  raw: number = 0;
  sets: string[] = [];
  get w(): number {
    return this.raw;
  }
  set w(v: number | string) {
    this.sets.push(typeof v);
    this.raw = typeof v === "string" ? v.length : v;
  }
}

class Keeps {
  raw: number | string = 0;
  get w(): number | string {
    return this.raw;
  }
  set w(v: number) {
    this.raw = v === 0 ? "zero" : v;
  }
}

class Unrelated {
  stored: string = "";
  get v(): number {
    return this.stored.length;
  }
  set v(text: string) {
    this.stored = text;
  }
}

const literal = {
  raw: 1,
  get half(): number {
    return this.raw / 2;
  },
  set half(v: number | boolean) {
    this.raw = v === true ? 100 : v === false ? 0 : v * 2;
  },
};

const width = new Width();
show("start", () => width.w);
show("the value of a store of a string", () => (width.w = "four"));
show("read back", () => width.w);
show("the value of a store of a number", () => (width.w = 2.5));
show("read back", () => width.w);
show("+=", () => (width.w += 1));
show("read back", () => width.w);
show("++ after", () => width.w++);
show("read back", () => width.w);
show("++ before", () => ++width.w);
show("sets", () => width.sets.join());

function asPlain(o: { w: number }): number {
  o.w = o.w + 10;
  return o.w;
}
show("as a plain number property", () => asPlain(width));
show("a plain object at the same function", () => asPlain({ w: 1 }));
show("sets", () => width.sets.join());

const keeps = new Keeps();
keeps.w = 5;
show("keeps 5", () => keeps.w);
keeps.w = 0;
show("keeps 0", () => keeps.w);
show("keeps: the value of the store", () => (keeps.w = 0));

const unrelated = new Unrelated();
unrelated.v = "hello";
show("unrelated read", () => unrelated.v);
show("unrelated read + 1", () => unrelated.v + 1);
show("unrelated: the value of the store", () => (unrelated.v = "ab"));
show("unrelated read", () => unrelated.v);

show("literal half", () => literal.half);
literal.half = true;
show("literal half after true", () => literal.half);
literal.half = 4;
show("literal half after 4", () => literal.half);
show("literal keys", () => Object.keys(literal).join());
show("literal as JSON", () => JSON.stringify(literal));

let sum = 0;
for (let i = 0; i < 2000; i++) {
  width.w = i;
  sum += width.w;
}
show("2000 numbers", () => sum);
width.w = "abc";
show("then a string", () => width.w);
