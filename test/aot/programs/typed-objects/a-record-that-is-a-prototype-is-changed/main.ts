import { makeOver, store } from "./sloppy.cjs";

const log: string[] = [];
const show = (title: string, said: unknown) => log.push(title + ": " + said);
const attempt = (run: () => unknown): string => {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
const describe = (object: object) => Object.keys(object).join() + " " + JSON.stringify(object);

interface Pair {
  a: number;
  b: number;
}
type Held = { a?: number; note?: string };
const rounds = 40;

function heirs(title: string, prototype: Held, change: (prototype: Held) => void, undo?: (prototype: Held) => void) {
  const typed = (a: number, b: number): Pair => {
    const self = Object.create(prototype);
    self.a = a;
    self.b = b;
    return self;
  };
  const untyped = (a: number, b: number): any => {
    const self: any = Object.create(prototype);
    self.a = a;
    self.b = b;
    return self;
  };
  const assigned = (a: number, b: number): Pair => Object.assign(Object.create(prototype), { a, b });
  const kept: any = Object.create(prototype);
  const ways: [string, () => unknown][] = [
    ["typed", () => describe(typed(1, 2))],
    ["untyped", () => describe(untyped(1, 2))],
    ["assigned", () => describe(assigned(1, 2))],
    ["sloppy", () => describe(makeOver(prototype, 1, 2))],
    ["Reflect.set", () => Reflect.set(Object.create(prototype), "a", 1)],
    ["an heir from before, sloppy", () => store(Object.create(kept), "a", 1)],
    ["read", () => typed(1, 2).a + " " + (Object.create(prototype) as Held).a + " " + (Object.create(prototype) as Held).note],
  ];
  for (let i = 0; i < rounds; i++) for (const way of ways) attempt(way[1]);
  for (const [name, run] of ways) show(title + ", before, " + name, attempt(run));
  change(prototype);
  for (const [name, run] of ways) show(title + ", after, " + name, attempt(run));
  for (let i = 0; i < rounds; i++) for (const way of ways) attempt(way[1]);
  for (const [name, run] of ways) show(title + ", later, " + name, attempt(run));
  if (undo) {
    undo(prototype);
    for (const [name, run] of ways) show(title + ", undone, " + name, attempt(run));
  }
}

const seen: string[] = [];
heirs("frozen", { a: 1 }, prototype => Object.freeze(prototype));
heirs("frozen without the name", {}, prototype => Object.freeze(prototype));
heirs("sealed", { a: 1 }, prototype => Object.seal(prototype));
heirs("no longer extensible", { a: 1 }, prototype => Object.preventExtensions(prototype));
heirs(
  "a setter",
  {},
  prototype => Object.defineProperty(prototype, "a", { set(value: number) { seen.push("a<-" + value); }, configurable: true }),
  prototype => delete (prototype as any).a,
);
heirs(
  "a setter over a value",
  { a: 1 },
  prototype => Object.defineProperty(prototype, "a", { set(value: number) { seen.push("A<-" + value); }, configurable: true }),
  prototype => Object.defineProperty(prototype, "a", { value: 3, writable: true, enumerable: true, configurable: true }),
);
heirs(
  "a getter alone",
  {},
  prototype => Object.defineProperty(prototype, "a", { get() { return 7; }, configurable: true }),
  prototype => delete (prototype as any).a,
);
heirs(
  "read-only",
  {},
  prototype => Object.defineProperty(prototype, "a", { value: 5, writable: false, configurable: true }),
  prototype => Object.defineProperty(prototype, "a", { writable: true }),
);
heirs(
  "read-only over a value",
  { a: 1 },
  prototype => Object.defineProperty(prototype, "a", { writable: false }),
  prototype => Object.defineProperty(prototype, "a", { writable: true }),
);
heirs(
  "a name the type does not declare",
  {},
  prototype => ((prototype as any).b = 9),
  prototype => delete (prototype as any).b,
);
heirs(
  "a declared name stored by typed code",
  {},
  prototype => (prototype.note = "late"),
  prototype => delete prototype.note,
);
heirs(
  "another prototype above",
  {},
  prototype => Object.setPrototypeOf(prototype, { set a(value: number) { seen.push("above<-" + value); } }),
  prototype => Object.setPrototypeOf(prototype, Object.prototype),
);
const Frozen: { a?: number } = { a: 1 };
function overFrozen(a: number, b: number): Pair {
  const self = Object.create(Frozen);
  self.a = a;
  self.b = b;
  return self;
}
function anyOverFrozen(a: number, b: number): any {
  const self: any = Object.create(Frozen);
  self.a = a;
  self.b = b;
  return self;
}
const assignedOverFrozen = (a: number, b: number): Pair => Object.assign(Object.create(Frozen), { a, b });
for (let i = 0; i < rounds; i++) overFrozen(i, i).a + anyOverFrozen(i, i).a + assignedOverFrozen(i, i).a + makeOver(Frozen, i, i).a;
show("a constant, before it is frozen", [describe(overFrozen(1, 2)), describe(anyOverFrozen(1, 2)), describe(assignedOverFrozen(1, 2)), describe(makeOver(Frozen, 1, 2))].join(" / "));
Object.freeze(Frozen);
show("a constant that is frozen, typed", attempt(() => describe(overFrozen(1, 2))));
show("a constant that is frozen, untyped", attempt(() => describe(anyOverFrozen(1, 2))));
show("a constant that is frozen, assigned", attempt(() => describe(assignedOverFrozen(1, 2))));
show("a constant that is frozen, sloppy", attempt(() => describe(makeOver(Frozen, 1, 2))));
show("a constant that is frozen, Reflect.set", attempt(() => Reflect.set(Object.create(Frozen), "a", 1)));

const Sealed: { a?: number } = { a: 1 };
function overSealed(a: number, b: number): Pair {
  const self = Object.create(Sealed);
  self.a = a;
  self.b = b;
  return self;
}
function anyOverSealed(a: number, b: number): any {
  const self: any = Object.create(Sealed);
  self.a = a;
  self.b = b;
  return self;
}
const assignedOverSealed = (a: number, b: number): Pair => Object.assign(Object.create(Sealed), { a, b });
for (let i = 0; i < rounds; i++) overSealed(i, i).a + anyOverSealed(i, i).a + assignedOverSealed(i, i).a + makeOver(Sealed, i, i).a;
show("a constant, before it is sealed", [describe(overSealed(1, 2)), describe(anyOverSealed(1, 2)), describe(assignedOverSealed(1, 2)), describe(makeOver(Sealed, 1, 2))].join(" / "));
Object.seal(Sealed);
show("a constant that is sealed, typed", attempt(() => describe(overSealed(1, 2))));
show("a constant that is sealed, untyped", attempt(() => describe(anyOverSealed(1, 2))));
show("a constant that is sealed, assigned", attempt(() => describe(assignedOverSealed(1, 2))));
show("a constant that is sealed, sloppy", attempt(() => describe(makeOver(Sealed, 1, 2))));
show("a constant that is sealed, Reflect.set", attempt(() => Reflect.set(Object.create(Sealed), "a", 1)));

const Closed: { a?: number } = { a: 1 };
function overClosed(a: number, b: number): Pair {
  const self = Object.create(Closed);
  self.a = a;
  self.b = b;
  return self;
}
function anyOverClosed(a: number, b: number): any {
  const self: any = Object.create(Closed);
  self.a = a;
  self.b = b;
  return self;
}
const assignedOverClosed = (a: number, b: number): Pair => Object.assign(Object.create(Closed), { a, b });
for (let i = 0; i < rounds; i++) overClosed(i, i).a + anyOverClosed(i, i).a + assignedOverClosed(i, i).a + makeOver(Closed, i, i).a;
show("a constant, before it is no longer extensible", [describe(overClosed(1, 2)), describe(anyOverClosed(1, 2)), describe(assignedOverClosed(1, 2)), describe(makeOver(Closed, 1, 2))].join(" / "));
Object.preventExtensions(Closed);
show("a constant that is no longer extensible, typed", attempt(() => describe(overClosed(1, 2))));
show("a constant that is no longer extensible, untyped", attempt(() => describe(anyOverClosed(1, 2))));
show("a constant that is no longer extensible, assigned", attempt(() => describe(assignedOverClosed(1, 2))));
show("a constant that is no longer extensible, sloppy", attempt(() => describe(makeOver(Closed, 1, 2))));
show("a constant that is no longer extensible, Reflect.set", attempt(() => Reflect.set(Object.create(Closed), "a", 1)));
const Apart: { a?: number } = { a: 1 };
function overApart(a: number, b: number): Pair {
  const self = Object.create(Apart);
  self.a = a;
  self.b = b;
  return self;
}
for (let i = 0; i < rounds; i++) overApart(i, i);
show("a constant that only typed code sees", describe(overApart(1, 2)));
Object.freeze(Apart);
show("a constant that only typed code sees, frozen", attempt(() => describe(overApart(1, 2))));
const ApartToo: { a?: number } = { a: 1 };
function anyOverApartToo(a: number, b: number): any {
  const self: any = Object.create(ApartToo);
  self.a = a;
  self.b = b;
  return self;
}
for (let i = 0; i < rounds; i++) anyOverApartToo(i, i);
show("a constant whose heirs have no type", describe(anyOverApartToo(1, 2)));
Object.freeze(ApartToo);
show("a constant whose heirs have no type, frozen", attempt(() => describe(anyOverApartToo(1, 2))));
const ApartAssigned: { a?: number } = { a: 1 };
const assignedOverApart = (a: number, b: number): Pair => Object.assign(Object.create(ApartAssigned), { a, b });
for (let i = 0; i < rounds; i++) assignedOverApart(i, i);
show("a constant whose heirs are assigned", describe(assignedOverApart(1, 2)));
Object.freeze(ApartAssigned);
show("a constant whose heirs are assigned, frozen", attempt(() => describe(assignedOverApart(1, 2))));
show("setters saw", seen.length + " " + [...new Set(seen)].join());
console.log(log.join("\n"));
