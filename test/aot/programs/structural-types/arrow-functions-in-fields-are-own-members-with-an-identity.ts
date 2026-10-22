function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Clickable {
  id: number;
  onClick: () => number;
}

let made = 0;

class Button {
  id: number;
  onClick = (): number => this.id * 10;
  order = ++made;
  onHover = (): string => "hover " + this.id;
  constructor(id: number) {
    this.id = id;
  }
}

const a = new Button(1);
const b = new Button(2);

console.log("the same function each time it is read: " + (a.onClick === a.onClick));
console.log("another one for each instance: " + (a.onClick === b.onClick));
console.log("keys before any call: " + Object.keys(new Button(3)).join());
console.log("own: " + Object.hasOwn(a, "onClick") + " on the prototype: " + ("onClick" in Button.prototype));
console.log("name and length: " + a.onClick.name + " " + a.onClick.length + " " + typeof a.onClick);
console.log("json leaves them out: " + JSON.stringify(a));
console.log("values: " + Object.values(a).map(v => typeof v).join());
console.log("entries: " + Object.entries(a).map(([key, value]) => key + ":" + typeof value).join());

const copy = { ...a };
console.log("a copy has the very same function: " + (copy.onClick === a.onClick) + " " + Object.keys(copy).join());
copy.id = 100;
console.log("which still sees the first object: " + copy.onClick() + " " + a.onClick());

const taken = a.onClick;
a.id = 5;
console.log("taken off, it follows its object: " + taken() + " " + taken.call(b) + " " + taken.bind(b)());

const notes = new WeakMap<object, string>();
notes.set(a.onClick, "noted");
console.log("as a weak key: " + notes.get(a.onClick) + " " + notes.get(b.onClick));
const set = new Set([a.onClick, a.onClick, b.onClick, a.onHover]);
console.log("in a set: " + set.size);

function click(c: Clickable): number {
  return c.onClick();
}

class WithMethod {
  id = 7;
  onClick(): number {
    return this.id * 1000;
  }
}

let total = 0;
for (let i = 0; i < 2000; i++) total += click(a);
console.log("2000 honest: " + total);
console.log("then others: " + click(b) + " " + click(new WithMethod()) + " " + click({ id: 0, onClick: () => -1 }) + " " + click(copy));

a.onClick = () => -5;
console.log("replaced: " + click(a) + " " + taken() + " " + Object.keys(a).join());

const loose: { onHover?: () => string } = b;
delete loose.onHover;
console.log("deleted: " + Object.keys(b).join() + " " + ("onHover" in b) + " " + typeof b.onHover);
attempt("called after it was deleted", () => b.onHover());

attempt("an instance with functions cannot be cloned", () => structuredClone(new Button(4)));
attempt("a frozen instance still answers", () => Object.freeze(new Button(5)).onClick());
attempt("a frozen instance keeps its function", () => {
  const frozen: Button = Object.freeze(new Button(6));
  frozen.onClick = () => 0;
  return "replaced";
});

console.log("initializers ran in order, once each: " + made + " " + new Button(9).order);

class Early {
  first = (): string => "sees " + this.second;
  second = "second";
  atConstruction = this.first();
}
console.log("called by a later initializer: " + new Early().atConstruction);

class Sub extends Button {
  onClick = (): number => -this.id;
}
const sub = new Sub(8);
console.log("a subclass defines it again: " + sub.onClick() + " " + Object.keys(sub).join() + " " + click(sub));

export {};
