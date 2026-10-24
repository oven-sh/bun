class Thing {
  x = 1;
  y = 2;
  m(): number {
    return 3;
  }
}

let target: Thing = new Thing();
let armed = false;

function mutate(): void {
  if (!armed) return;
  target.x = 100;
  target.m = () => -1;
  Object.freeze(target);
}

function mutated(): number {
  mutate();
  return 0;
}

class Trigger {
  list = [1];
  optional?: number = 1;
  toString(): string {
    mutate();
    return "t";
  }
  valueOf(): number {
    mutate();
    return 0;
  }
  toJSON(): string {
    mutate();
    return "j";
  }
  get read(): number {
    mutate();
    return 0;
  }
  set write(value: number) {
    mutate();
  }
  *[Symbol.iterator](): Generator<number> {
    mutate();
    yield 1;
  }
  static [Symbol.hasInstance](value: unknown): boolean {
    void value;
    mutate();
    return true;
  }
}

const trapped: { key?: number } = new Proxy<{ key?: number }>({ key: 1 }, {
  has() {
    mutate();
    return true;
  },
  deleteProperty() {
    mutate();
    return true;
  },
});

function after(p: Thing, before: number): string {
  let stored = "stored";
  try {
    p.y = 5;
  } catch {
    stored = "threw";
  }
  return before + " -> " + p.x + " " + p.m() + " " + stored;
}

function tag(strings: TemplateStringsArray): string {
  mutate();
  return strings[0];
}

const forms: [string, (p: Thing, t: Trigger) => string][] = [
  ["nothing", p => { const b = p.x + p.m(); return after(p, b); }],
  ["a call", p => { const b = p.x + p.m(); mutate(); return after(p, b); }],
  ["a template", (p, t) => { const b = p.x + p.m(); `${t}`; return after(p, b); }],
  ["concatenation", (p, t) => { const b = p.x + p.m(); "" + t; return after(p, b); }],
  ["unary plus", (p, t) => { const b = p.x + p.m(); +t; return after(p, b); }],
  ["String()", (p, t) => { const b = p.x + p.m(); String(t); return after(p, b); }],
  ["join", (p, t) => { const b = p.x + p.m(); [t].join(); return after(p, b); }],
  ["JSON.stringify", (p, t) => { const b = p.x + p.m(); JSON.stringify(t); return after(p, b); }],
  ["a getter", (p, t) => { const b = p.x + p.m(); t.read; return after(p, b); }],
  ["a setter", (p, t) => { const b = p.x + p.m(); t.write = 1; return after(p, b); }],
  ["for-of", (p, t) => { const b = p.x + p.m(); for (const _ of t); return after(p, b); }],
  ["an array spread", (p, t) => { const b = p.x + p.m(); [...t]; return after(p, b); }],
  ["an array pattern", (p, t) => { const b = p.x + p.m(); const [first] = t; return after(p, b + first - 1); }],
  ["an object spread", (p, t) => { const b = p.x + p.m(); ({ ...{ get g() { return t.read; } } }); return after(p, b); }],
  ["instanceof", (p, t) => { const b = p.x + p.m(); t instanceof Trigger; return after(p, b); }],
  ["in", p => { const b = p.x + p.m(); "key" in trapped; return after(p, b); }],
  ["delete", p => { const b = p.x + p.m(); delete trapped.key; return after(p, b); }],
  ["a callback of map", (p, t) => { const b = p.x + p.m(); t.list.map(mutate); return after(p, b); }],
  ["a comparator", p => { const b = p.x + p.m(); [2, 1].sort((l, r) => (mutate(), l - r)); return after(p, b); }],
  ["a default in a pattern", p => { const b = p.x + p.m(); const { missing = mutated() }: { missing?: number } = {}; return after(p, b + missing); }],
  ["a default parameter", p => { const b = p.x + p.m(); ((v = mutate()) => v)(); return after(p, b); }],
  ["a tagged template", p => { const b = p.x + p.m(); tag`x`; return after(p, b); }],
  ["a constructor", p => { const b = p.x + p.m(); new (class { constructor() { mutate(); } })(); return after(p, b); }],
  ["a catch block", p => { const b = p.x + p.m(); try { throw new Error("e"); } catch { mutate(); } return after(p, b); }],
  ["a finally block", p => { const b = p.x + p.m(); try { b.toFixed(); } finally { mutate(); } return after(p, b); }],
  ["a computed key", (p, t) => { const b = p.x + p.m(); ({ [`${t}`]: 1 }); return after(p, b); }],
];

const trigger = new Trigger();

for (const [, form] of forms) for (let i = 0; i < 300; i++) form(new Thing(), trigger);

for (const [label, form] of forms) {
  target = new Thing();
  armed = true;
  const result = form(target, trigger);
  armed = false;
  console.log(label + ": " + result);
}

for (const [label, form] of forms) console.log(label + ", unarmed again: " + form(new Thing(), trigger));

export {};
