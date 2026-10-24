function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Tally {
  count = 1;
  names: string[] = ["first"];
  add(name: string): number {
    this.names.push(name);
    this.count += 1;
    return this.count;
  }
  get last(): string {
    return this.names[this.names.length - 1];
  }
}

function use(t: Tally): string {
  return t.add("more") + " " + t.last + " " + t.count;
}

function fields(t: Tally): string {
  return t.count + " " + t.names.join("+");
}

function facts(t: Tally): string {
  return (t instanceof Tally) + " " + Object.keys(t).join() + " " + typeof t.add + " " + JSON.stringify(t);
}

const makers: [string, (source: Tally) => Tally][] = [
  ["the instance itself", source => source],
  ["structuredClone", source => structuredClone(source)],
  ["Object.assign onto a literal", source => Object.assign({}, source)],
  ["Object.assign onto a bare prototype", source => Object.assign(Object.create(Tally.prototype), source)],
  ["Object.create of the instance", source => Object.create(source)],
  ["Object.create of the prototype", () => Object.create(Tally.prototype)],
  ["a proxy", source => new Proxy(source, {})],
  ["Reflect.construct", () => Reflect.construct(Tally, [])],
  ["Reflect.construct for Object", () => Reflect.construct(Tally, [], Object)],
];

for (const [label, make] of makers) {
  const source = new Tally();
  const made = make(source);
  attempt(label + ", facts", () => facts(made));
  attempt(label + ", fields", () => fields(made));
  attempt(label + ", methods", () => use(made));
  attempt(label + ", afterwards", () => facts(made));
  attempt(label + ", the source afterwards", () => fields(source));
}

const honest = new Tally();
for (let i = 0; i < 2000; i++) honest.add("n");
console.log("2000 honest: " + honest.count + " " + honest.names.length);
const addTo = (t: Tally) => t.add("x");
for (let i = 0; i < 2000; i++) addTo(honest);
attempt("then a clone at that site", () => addTo(structuredClone(new Tally())));
attempt("then a child at that site", () => addTo(Object.create(new Tally())));
attempt("then an instance", () => addTo(new Tally()));

const parent = new Tally();
const child: Tally = Object.create(parent);
const sibling: Tally = Object.create(parent);
child.add("by the child");
console.log("the child's count is its own: " + Object.hasOwn(child, "count") + " " + child.count + " " + parent.count + " " + sibling.count);
console.log("the list is shared: " + Object.hasOwn(child, "names") + " " + parent.names.join("+") + " " + sibling.last);
parent.count = 50;
console.log("the parent stored: " + child.count + " " + sibling.count);

const list: Tally[] = makers.slice(0, 5).map(([, make]) => make(new Tally()));
console.log("counts: " + list.map(t => t.count).join());
console.log("instances: " + list.map(t => t instanceof Tally).join());
attempt("all called", () => list.map(t => t.add("z")).join());

export {};
