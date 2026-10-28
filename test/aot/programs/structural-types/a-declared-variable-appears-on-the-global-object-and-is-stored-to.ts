function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare let missingTotal: number;
declare var missingName: string;
declare let missingItems: number[];

const log: string[] = [];
function noted(n: number): number {
  log.push("ran " + n);
  return n;
}

function store(n: number): void {
  missingTotal = n;
}

function read(): number {
  return missingTotal;
}

show("is this strict code", () => (function (this: unknown) {
  return this === undefined;
})());
show("typeof before", () => [typeof missingTotal, typeof missingName]);
show("a store", () => (missingTotal = 5));
show("typeof after the store", () => typeof missingTotal);
show("the right side runs before the store fails", () => (missingTotal = noted(1)));
show("the log", () => log.join());
show("through a function", () => store(6));
show("+=", () => (missingTotal += 1));
show("++", () => missingTotal++);
show("??=", () => (missingTotal ??= 1));
show("a store to the var", () => (missingName = "text"));
show("taken apart into it", () => {
  [missingTotal] = [7];
  return "stored";
});
show("a store to an element of the list", () => (missingItems[0] = 1));
show("on the global object", () => ["missingTotal" in globalThis, "missingName" in globalThis]);

Object.assign(globalThis, { missingTotal: 10 });
show("after the global object has it: read", () => [missingTotal, read(), typeof missingTotal]);
show("after the global object has it: a store", () => (missingTotal = 11));
show("after the global object has it: through functions", () => {
  store(12);
  return read();
});
show("after the global object has it: ++", () => [missingTotal++, missingTotal]);
show("after the global object has it: what the object says", () => Reflect.get(globalThis, "missingTotal"));

let sum = 0;
for (let i = 0; i < 2000; i++) {
  store(i);
  sum += read();
}
show("2000 stores and reads", () => sum);

Reflect.deleteProperty(globalThis, "missingTotal");
show("after it is deleted: typeof", () => typeof missingTotal);
show("after it is deleted: read", () => read());
show("after it is deleted: a store", () => store(1));
