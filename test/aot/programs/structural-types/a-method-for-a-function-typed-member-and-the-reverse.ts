interface WithProperty {
  id: number;
  compute: (n: number) => number;
}

interface WithMethod {
  id: number;
  compute(n: number): number;
}

class MethodForm {
  id = 1;
  compute(n: number): number {
    return n + this.id;
  }
}

class ArrowField {
  id = 2;
  compute = (n: number): number => n * 10 + this.id;
}

class FunctionField {
  id = 3;
  compute = function (this: void, n: number): number {
    return n * 100;
  };
}

class GetterForm {
  id = 4;
  fetched = 0;
  get compute(): (n: number) => number {
    this.fetched++;
    return n => n * 1000 + this.fetched;
  }
}

class StaticBorrowed {
  id = 5;
  compute = Math.abs;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function callProperty(o: WithProperty): number {
  return o.compute(-7);
}

function callMethod(o: WithMethod): number {
  return o.compute(-7);
}

function detachProperty(o: WithProperty): number {
  const f = o.compute;
  return f(-7);
}

function detachMethod(o: WithMethod): number {
  const { compute } = o;
  return compute(-7);
}

function where(o: WithMethod): string {
  return Object.hasOwn(o, "compute") + " " + Object.keys(o).join() + " " + JSON.stringify(o) + " " + Object.keys({ ...o }).join();
}

function makers(): [string, () => WithProperty & WithMethod][] {
  return [
    ["a method", () => new MethodForm()],
    ["an arrow in a field", () => new ArrowField()],
    ["a function in a field", () => new FunctionField()],
    ["a getter that returns a function", () => new GetterForm()],
    ["a built-in in a field", () => new StaticBorrowed()],
    ["a literal with a method", () => ({ id: 6, compute(n: number) { return n - this.id; } })],
    ["a literal with an arrow", () => ({ id: 7, compute: (n: number) => n - 7 })],
  ];
}

for (const [label, make] of makers()) {
  attempt(label + ", called as a property", () => callProperty(make()));
  attempt(label + ", called as a method", () => callMethod(make()));
  attempt(label + ", taken off as a property", () => detachProperty(make()));
  attempt(label + ", taken off as a method", () => detachMethod(make()));
  attempt(label + ", where it lives", () => where(make()));
  attempt(label + ", on a copy", () => {
    const copy = { ...make() };
    return typeof copy.compute;
  });
  attempt(label + ", replaced", () => {
    const o = make();
    o.compute = n => n;
    return callProperty(o) + " " + callMethod(o) + " " + Object.hasOwn(o, "compute");
  });
  attempt(label + ", called with another this", () => make().compute.call({ id: 1000 }, -7));
}

const honest = new MethodForm();
let total = 0;
for (let i = 0; i < 2000; i++) total += callMethod(honest) + callProperty(honest);
console.log("2000 honest: " + total);
console.log("then each at those sites: " + makers().map(([, make]) => callMethod(make()) + "/" + callProperty(make())).join());

const getter = new GetterForm();
callMethod(getter);
callProperty(getter);
console.log("the getter ran once a call: " + getter.fetched);

export {};
