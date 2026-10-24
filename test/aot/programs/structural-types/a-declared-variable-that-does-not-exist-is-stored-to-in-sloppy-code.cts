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

declare let sloppyTotal: number;
declare var sloppyName: string;
declare const sloppyFixed: number;
declare function sloppyHelper(n: number): number;

function store(n: number): void {
  sloppyTotal = n;
}

function read(): number {
  return sloppyTotal;
}

show("is this strict code", () =>
  (function (this: unknown) {
    return this === undefined;
  })(),
);
show("typeof before", () => [typeof sloppyTotal, typeof sloppyName, typeof sloppyFixed, typeof sloppyHelper]);
show("read before", () => read());
show("++ before", () => sloppyTotal++);
show("+= before", () => (sloppyTotal += 1));
show("typeof after the failed ones", () => typeof sloppyTotal);
show("a store makes a global", () => (sloppyTotal = 5));
show("after it", () => [sloppyTotal, read(), typeof sloppyTotal, "sloppyTotal" in globalThis]);
show("through a function", () => {
  store(6);
  return [read(), read() + 1];
});
show("++ now", () => [sloppyTotal++, sloppyTotal]);
show("a store to the var", () => [(sloppyName = "text"), sloppyName.length, "sloppyName" in globalThis]);
show("taken apart into both", () => {
  [sloppyTotal, sloppyName] = [7, "seven"];
  return [sloppyTotal, sloppyName];
});
show("the function is still not there", () => sloppyHelper(1));
show("the constant is still not there", () => sloppyFixed);

let sum = 0;
for (let i = 0; i < 2000; i++) {
  store(i);
  sum += read();
}
show("2000 stores and reads", () => sum);

const everything: Record<string, unknown> = globalThis;
show("deleted by name", () => delete everything["sloppyTotal"]);
show("after it", () => [typeof sloppyTotal, "sloppyTotal" in globalThis]);
show("read after it", () => read());
show("a store makes it again", () => {
  store(1);
  return read();
});
