function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "list" : "object";
  return typeof value + " " + String(value);
}

let counts: string[] = [];

function counting(): number {
  counts.push(arguments.length + "(" + Array.from(arguments, text).join("; ") + ")");
  return 0;
}

function countingText(): string {
  Reflect.apply(counting, null, arguments);
  return "-";
}

function report(label: string, run: () => unknown): void {
  counts = [];
  run();
  console.log(label + ": " + counts.join(" "));
}

report("forEach", () => [5].forEach(counting));
report("map", () => [5].map(counting));
report("filter", () => [5].filter(counting));
report("find", () => [5].find(counting));
report("findLast", () => [5].findLast(counting));
report("some", () => [5].some(counting));
report("every", () => [5].every(counting));
report("flatMap", () => [5].flatMap(counting));
report("reduce", () => [5, 6].reduce(counting));
report("reduce with a start", () => [5].reduce(counting, 1));
report("reduceRight", () => [5, 6].reduceRight(counting));
report("toSorted", () => [5, 6].toSorted(counting));
report("Array.from", () => Array.from([5], counting));
report("Array.from an array-like", () => Array.from({ length: 1 }, counting));
report("a typed array's map", () => new Uint8Array([5]).map(counting));
report("a set's forEach", () => new Set([5]).forEach(counting));
report("a map's forEach", () => new Map([[5, 6]]).forEach(counting));
report("an iterator's map", () => [5].values().map(counting).toArray());
report("an iterator's reduce", () => [5, 6].values().reduce(counting));
report("replace with a text", () => "abc".replace("b", countingText));
report("replace with two groups", () => "abc".replace(/(a)(b)/, countingText));
report("replace with a named group", () => "abc".replace(/(?<first>a)/, countingText));
report("replaceAll", () => "aa".replaceAll("a", countingText));
report("JSON.stringify's replacer", () => JSON.stringify({ k: 1 }, counting));
report("Object.groupBy", () => Object.groupBy([5], counting));
report("Map.groupBy", () => Map.groupBy([5], counting));
const slot: { x?: number } = {};
report("a getter", () => Object.defineProperty(slot, "x", { get: counting, configurable: true }).x);
report("a setter", () => {
  Object.defineProperty(slot, "x", { set: counting, configurable: true }).x = 5;
});
report("valueOf", () => +Object({ valueOf: counting }));
report("toString in a template", () => `${Object({ toString: countingText })}`);
report("Symbol.toPrimitive", () => `${Object({ [Symbol.toPrimitive]: countingText })}`);
report("toJSON", () => JSON.stringify({ k: { toJSON: counting } }));
const tag: (strings: TemplateStringsArray, ...values: number[]) => number = counting;
report("a tag", () => tag`a${1}b`);
report("a proxy's get trap", () => new Proxy<{ x?: number }>({}, { get: counting }).x);
report("a proxy's apply trap", () => new Proxy(counting, { apply: counting })());

counts = [];
await Promise.resolve(5).then(counting);
await Promise.reject(5).catch(counting);
await Promise.resolve(5).finally(counting);
await new Promise<void>(resolve => queueMicrotask(() => {
  counting();
  resolve();
}));
new Promise(counting);
console.log("then, catch, finally, a job, an executor: " + counts.join(" "));

function own(visit: (a: number, b: string, c: boolean, d: null) => void): void {
  visit(1, "two", true, null);
}
report("the program's own function gives four", () => own(counting));
report("through bind with two more", () => own(counting.bind(null)));

export {};
