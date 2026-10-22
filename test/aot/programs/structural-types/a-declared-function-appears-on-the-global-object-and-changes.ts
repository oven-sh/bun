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

declare function missingTwice(n: number): number;
declare function missingJoin(...parts: string[]): string;
declare const missingStep: (n: number) => number;

const log: string[] = [];
function noted(n: number): number {
  log.push("ran " + n);
  return n;
}

function apply(f: (n: number) => number, n: number): number {
  return f(n);
}

function callIt(n: number): number {
  return missingTwice(n);
}

function callItIfThere(n: number): number {
  return typeof missingTwice === "function" ? missingTwice(n) : -1;
}

show("typeof", () => [typeof missingTwice, typeof missingJoin, typeof missingStep]);
show("called", () => missingTwice(1));
show("the argument does not run", () => missingTwice(noted(1)));
show("the log", () => log.join());
show("its result used", () => missingTwice(1) + 1);
show("called with many", () => missingJoin("a", "b"));
show("the constant called", () => missingStep(1));
show("read", () => missingTwice);
show("called if there", () => missingTwice?.(1));
show("call", () => missingTwice.call(undefined, 1));
show("through a function", () => callIt(1));
show("guarded by typeof", () => callItIfThere(1));
show("given to a typed function", () => apply(missingTwice, 1));
show("as a callback", () => [1, 2].map(missingTwice));
show("as a callback of an empty list", () => {
  const none: number[] = [];
  return none.map(missingTwice);
});
show("with new", () => Reflect.construct(missingTwice, []));
show("an honest caller of the same function", () => apply(n => n * 2, 2));

Object.assign(globalThis, {
  missingTwice(n: number): number {
    return n * 2;
  },
});
show("after the global object has it", () => [typeof missingTwice, missingTwice(2), callIt(3), callItIfThere(4), apply(missingTwice, 5), [1, 2].map(missingTwice)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += callIt(i);
show("2000 calls", () => sum);

Object.assign(globalThis, { missingTwice: (n: number): string => "text " + n });
show("after it is another function", () => [missingTwice(2), typeof callIt(3), callIt(3) + 1]);

Reflect.deleteProperty(globalThis, "missingTwice");
show("after it is deleted", () => [typeof missingTwice, callItIfThere(1)]);
show("after it is deleted: called", () => callIt(1));
