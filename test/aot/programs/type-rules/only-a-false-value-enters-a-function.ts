// A function that only a value of another type than its parameter ever enters: the call throws a TypeError at the parameter, whatever the body, which never runs, does with the parameter.
function describe(error: unknown): string {
  if (!(error instanceof Error)) return "thrown: " + String(error);
  const e = error;
  const message = e.message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "");
  // The text of an error of the language is not the subject here.
  if (!/(^|: )expected /.test(message)) return e.name;
  const position = message.includes(", got ") ? /:(\d+):(\d+)\)?\s*$/m.exec(e.stack ?? "") : null;
  return e.name + ": " + message + (position ? " | " + position[1] + ":" + position[2] : "");
}
async function attempt(name: string, f: () => unknown): Promise<void> {
  try { console.log(name, "|", "no error:", String(await f())); } catch (error) { console.log(name, "|", describe(error)); }
}
let kept: unknown;
{
  function entered(n: number) { return String(n); }
  await attempt("string-call", () => entered("4" as any));
}
{
  function entered(s: string) { return Number(s); }
  await attempt("number-call", () => entered(5 as any));
}
{
  function entered(n: number) { return Boolean(n); }
  await attempt("boolean-call", () => entered("4" as any));
}
{
  function entered(n: number) { return BigInt(n); }
  await attempt("bigint-call", () => entered("4" as any));
}
{
  function entered(s: string) { return Symbol(s); }
  await attempt("symbol-call", () => entered(5 as any));
}
{
  function entered(n: number) { return Object(n); }
  await attempt("object-call", () => entered("4" as any));
}
{
  function entered(n: number) { return Array(n); }
  await attempt("array-call", () => entered("4" as any));
}
{
  function entered(n: number) { return new Array(n); }
  await attempt("new-array", () => entered("4" as any));
}
{
  function entered(n: number) { return new Date(n); }
  await attempt("new-date", () => entered("4" as any));
}
{
  function entered(a: [string, number][]) { return new Map(a); }
  await attempt("new-map", () => entered(5 as any));
}
{
  function entered(a: number[]) { return new Set(a); }
  await attempt("new-set", () => entered(5 as any));
}
{
  function entered(s: string) { return new Error(s); }
  await attempt("new-error", () => entered(5 as any));
}
{
  function entered(s: string) { return new RegExp(s); }
  await attempt("new-regexp", () => entered(5 as any));
}
{
  function entered(f: (r: (v: number) => void) => void) { return new Promise(f); }
  await attempt("new-promise", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return new Proxy(o, {}); }
  await attempt("new-proxy", () => entered(5 as any));
}
{
  function entered(n: number) { return new Uint8Array(n); }
  await attempt("new-uint8array", () => entered("4" as any));
}
{
  function entered(a: [object, number][]) { return new WeakMap(a); }
  await attempt("new-weak-map", () => entered(5 as any));
}
{
  function entered(s: string) { return new URL(s); }
  await attempt("new-url", () => entered(5 as any));
}
{
  function entered(n: number) { return Math.max(n, 1); }
  await attempt("math-max", () => entered("4" as any));
}
{
  function entered(n: number) { return Math.floor(n); }
  await attempt("math-floor", () => entered("4" as any));
}
{
  function entered(n: number) { return Math.abs(n); }
  await attempt("math-abs", () => entered("4" as any));
}
{
  function entered(n: number) { return Math.pow(n, 2); }
  await attempt("math-pow", () => entered("4" as any));
}
{
  function entered(s: string) { return parseInt(s); }
  await attempt("parse-int", () => entered(5 as any));
}
{
  function entered(s: string) { return parseFloat(s); }
  await attempt("parse-float", () => entered(5 as any));
}
{
  function entered(n: number) { return isNaN(n); }
  await attempt("is-nan", () => entered("4" as any));
}
{
  function entered(n: number) { return Number.isInteger(n); }
  await attempt("number-is-integer", () => entered("4" as any));
}
{
  function entered(o: { a: number }) { return JSON.stringify(o); }
  await attempt("json-stringify", () => entered(5 as any));
}
{
  function entered(s: string) { return JSON.parse(s); }
  await attempt("json-parse", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return Object.keys(o); }
  await attempt("object-keys", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return Object.entries(o); }
  await attempt("object-entries", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return Object.assign({}, o); }
  await attempt("object-assign", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return Object.freeze(o); }
  await attempt("object-freeze", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return Object.create(o); }
  await attempt("object-create", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return Object.getPrototypeOf(o); }
  await attempt("object-get-prototype-of", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return Object.defineProperty(o, "b", { value: 1 }); }
  await attempt("object-define-property", () => entered(5 as any));
}
{
  function entered(a: [string, number][]) { return Object.fromEntries(a); }
  await attempt("object-from-entries", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return Reflect.ownKeys(o); }
  await attempt("reflect-own-keys", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return Reflect.get(o, "a"); }
  await attempt("reflect-get", () => entered(5 as any));
}
{
  function entered(f: () => number) { return Reflect.apply(f, null, []); }
  await attempt("reflect-apply", () => entered(5 as any));
}
{
  function entered(a: number[]) { return Array.isArray(a); }
  await attempt("array-is-array", () => entered(5 as any));
}
{
  function entered(a: number[]) { return Array.from(a); }
  await attempt("array-from", () => entered(5 as any));
}
{
  function entered(n: number) { return Array.of(n); }
  await attempt("array-of", () => entered("4" as any));
}
{
  function entered(n: number) { return [1].push(n); }
  await attempt("array-push", () => entered("4" as any));
}
{
  function entered(n: number) { return [1].includes(n); }
  await attempt("array-includes", () => entered("4" as any));
}
{
  function entered(n: number) { return [1].indexOf(n); }
  await attempt("array-index-of", () => entered("4" as any));
}
{
  function entered(a: number[]) { return [1].concat(a); }
  await attempt("array-concat", () => entered(5 as any));
}
{
  function entered(f: (n: number) => number) { return [1].map(f); }
  await attempt("array-map", () => entered(5 as any));
}
{
  function entered(f: (n: number) => void) { return [1].forEach(f); }
  await attempt("array-for-each", () => entered(5 as any));
}
{
  function entered(f: (n: number) => boolean) { return [1].filter(f); }
  await attempt("array-filter", () => entered(5 as any));
}
{
  function entered(f: (a: number, b: number) => number) { return [1, 2].reduce(f); }
  await attempt("array-reduce", () => entered(5 as any));
}
{
  function entered(f: (a: number, b: number) => number) { return [2, 1].sort(f); }
  await attempt("array-sort", () => entered(5 as any));
}
{
  function entered(f: (n: number) => boolean) { return [1].find(f); }
  await attempt("array-find", () => entered(5 as any));
}
{
  function entered(s: string) { return [1, 2].join(s); }
  await attempt("array-join", () => entered(5 as any));
}
{
  function entered(n: number) { return [1, 2].slice(n); }
  await attempt("array-slice", () => entered("4" as any));
}
{
  function entered(n: number) { return [1, 2].fill(n); }
  await attempt("array-fill", () => entered("4" as any));
}
{
  function entered(n: number) { return [1, 2].at(n); }
  await attempt("array-at", () => entered("4" as any));
}
{
  function entered(a: number[]) { return a.map(x => x); }
  await attempt("own-array-map", () => entered(5 as any));
}
{
  function entered(a: number[]) { return a.length; }
  await attempt("own-array-length", () => entered(5 as any));
}
{
  function entered(a: number[]) { return [...a]; }
  await attempt("own-array-spread", () => entered(5 as any));
}
{
  function entered(a: number[]) { return (() => { let t = 0; for (const x of a) t += x; return t; })(); }
  await attempt("own-array-for-of", () => entered(5 as any));
}
{
  function entered(s: string) { return "a".concat(s); }
  await attempt("string-concat", () => entered(5 as any));
}
{
  function entered(s: string) { return "a".includes(s); }
  await attempt("string-includes", () => entered(5 as any));
}
{
  function entered(s: string) { return "a,b".split(s); }
  await attempt("string-split", () => entered(5 as any));
}
{
  function entered(s: string) { return "a".replace("a", s); }
  await attempt("string-replace", () => entered(5 as any));
}
{
  function entered(n: number) { return "a".repeat(n); }
  await attempt("string-repeat", () => entered("4" as any));
}
{
  function entered(n: number) { return "a".charAt(n); }
  await attempt("string-char-at", () => entered("4" as any));
}
{
  function entered(n: number) { return "a".padStart(n); }
  await attempt("string-pad-start", () => entered("4" as any));
}
{
  function entered(n: number) { return String.fromCharCode(n); }
  await attempt("string-from-char-code", () => entered("4" as any));
}
{
  function entered(s: string) { return s.toUpperCase(); }
  await attempt("own-string-method", () => entered(5 as any));
}
{
  function entered(s: string) { return s.length; }
  await attempt("own-string-length", () => entered(5 as any));
}
{
  function entered(s: string) { return s[0]; }
  await attempt("own-string-index", () => entered(5 as any));
}
{
  function entered(s: string) { return `<${s}>`; }
  await attempt("own-string-template", () => entered(5 as any));
}
{
  function entered(n: number) { return n.toFixed(1); }
  await attempt("number-to-fixed", () => entered("4" as any));
}
{
  function entered(n: number) { return n.toString(); }
  await attempt("number-to-string", () => entered("4" as any));
}
{
  function entered(n: number) { return (1.5).toFixed(n); }
  await attempt("to-fixed-argument", () => entered("4" as any));
}
{
  function entered(n: number) { return new Map<string, number>().set("a", n); }
  await attempt("map-set", () => entered("4" as any));
}
{
  function entered(s: string) { return new Map<string, number>().get(s); }
  await attempt("map-get", () => entered(5 as any));
}
{
  function entered(n: number) { return new Set<number>().add(n); }
  await attempt("set-add", () => entered("4" as any));
}
{
  function entered(n: number) { return new Set<number>().has(n); }
  await attempt("set-has", () => entered("4" as any));
}
{
  function entered(n: number) { return Promise.resolve(n); }
  await attempt("promise-resolve", () => entered("4" as any));
}
{
  function entered(f: (n: number) => number) { return Promise.resolve(1).then(f); }
  await attempt("promise-then", () => entered(5 as any));
}
{
  function entered(a: Promise<number>[]) { return Promise.all(a); }
  await attempt("promise-all", () => entered(5 as any));
}
{
  function entered(f: () => void) { return clearTimeout(setTimeout(f, 0)); }
  await attempt("set-timeout", () => entered(5 as any));
}
{
  function entered(f: () => void) { return queueMicrotask(f); }
  await attempt("queue-microtask", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return structuredClone(o); }
  await attempt("structured-clone", () => entered(5 as any));
}
{
  function entered(f: () => number) { return f.call(null); }
  await attempt("function-call", () => entered(5 as any));
}
{
  function entered(f: () => number) { return f.apply(null, []); }
  await attempt("function-apply", () => entered(5 as any));
}
{
  function entered(f: () => number) { return f.bind(null); }
  await attempt("function-bind", () => entered(5 as any));
}
{
  function entered(f: () => number) { return f(); }
  await attempt("call-argument", () => entered(5 as any));
}
{
  function entered(c: new () => object) { return new c(); }
  await attempt("new-argument", () => entered(5 as any));
}
{
  function entered(n: number) { return ((v: unknown) => typeof v)(n); }
  await attempt("closure-call", () => entered("4" as any));
}
{
  function entered(n: number) { return typeof n; }
  await attempt("typeof", () => entered("4" as any));
}
{
  function entered(n: number) { return n + 1; }
  await attempt("add", () => entered("4" as any));
}
{
  function entered(n: number) { return n < 1; }
  await attempt("compare", () => entered("4" as any));
}
{
  function entered(n: number) { return n === 1; }
  await attempt("strict-equal", () => entered("4" as any));
}
{
  function entered(n: number) { return -n; }
  await attempt("negate", () => entered("4" as any));
}
{
  function entered(n: number) { return !n; }
  await attempt("not", () => entered("4" as any));
}
{
  function entered(o: { a: number }) { return "a" in o; }
  await attempt("in", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return o instanceof Object; }
  await attempt("instanceof", () => entered(5 as any));
}
{
  function entered(c: new () => object) { return ({}) instanceof c; }
  await attempt("instanceof-right", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return o.a; }
  await attempt("read", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return (o.a = 1); }
  await attempt("store", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return ({ ...o }); }
  await attempt("spread-object", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return (() => { const { a } = o; return a; })(); }
  await attempt("destructure", () => entered(5 as any));
}
{
  function entered(n: number) { return ({ n }); }
  await attempt("literal", () => entered("4" as any));
}
{
  function entered(n: number) { return [n]; }
  await attempt("array-literal", () => entered("4" as any));
}
{
  function entered(n: number) { return n; }
  await attempt("return", () => entered("4" as any));
}
{
  function entered(n: number) { return (() => n)(); }
  await attempt("capture", () => entered("4" as any));
}
{
  function entered(n: number) { return (kept = n); }
  await attempt("store-variable", () => entered("4" as any));
}
{
  function entered(n: number) { return (async () => await n)(); }
  await attempt("await", () => entered("4" as any));
}
{
  function entered(n: number) { return (() => { throw n; })(); }
  await attempt("throw", () => entered("4" as any));
}
{
  function entered(n: number) { return (() => { switch (n) { case 1: return "one"; default: return "other"; } })(); }
  await attempt("switch", () => entered("4" as any));
}
{
  function entered(n: number) { return (() => { let t = 0; for (let i = 0; i < n; i++) t += i; return t; })(); }
  await attempt("loop", () => entered("4" as any));
}
{
  function entered(s: string) { return Buffer.from(s); }
  await attempt("buffer-from", () => entered(5 as any));
}
{
  function entered(s: string) { return new TextEncoder().encode(s); }
  await attempt("text-encoder", () => entered(5 as any));
}
{
  function entered(o: { a: number }) { return Bun.inspect(o); }
  await attempt("bun-inspect", () => entered(5 as any));
}
{
  function entered(f: () => void) { return process.nextTick(f); }
  await attempt("process-next-tick", () => entered(5 as any));
}
{
  function entered(n: number) { console.log(n); }
  await attempt("console-log", () => entered("4" as any));
}
console.log("after", typeof kept);
export {};
