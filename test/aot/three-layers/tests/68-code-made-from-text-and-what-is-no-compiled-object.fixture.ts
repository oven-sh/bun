import { check } from "../src/show";
import * as merge from "fake-merge";
import { codeFromText, payloadOfThePackage, readPayloadInThePackage, StaticsOfThePackage, Theirs } from "fake-merge";
import * as settings from "../src/settings";
import { codeFromTextInTheMiddle, readRowInTheApplication, rowOfTheApplication, Settings, StaticsOfTheApplication } from "../src/settings";
const F = "68";
class StaticsOfTheTestFile { static limit = 5; static label = "test file"; static twice() { return this.limit * 2; } }
const pairOfTheTestFile = (left: number, right: string) => ({ left, right });
const readPairInTheTestFile = (pair: { left: number; right: string }) => [pair.left, pair.right, Object.keys(pair).join()];
const attempt = (body: () => unknown) => { try { return body(); } catch (error: any) { return "threw " + error.constructor.name; } };
const warm = <T,>(body: () => T) => { let last = body(); for (let i = 0; i < 40; i++) last = body(); return last; };
// Code that is made from text is of no image. What it asks of ordinary objects, classes, functions and namespaces, and the objects that its own literals make.
for (const [where, make] of [["the package", codeFromText], ["the application", codeFromTextInTheMiddle], ["the test file", (parameters: string[], body: string) => new Function(...parameters, body)]] as const) {
  check(F, `literals with the names of each image's objects in ${where}`, () => {
    const payload = make(["v"], "return { value: v, issues: [] };"), row = make(["i", "t"], "return { id: i, title: t, done: false };"), pair = make(["l", "r"], "return { left: l, right: r };");
    return warm(() => [readPayloadInThePackage(payload(1)), readPayloadInThePackage(payload("text")), readPayloadInThePackage(payload(undefined)), readPayloadInThePackage(payload({ deep: [1] })), readRowInTheApplication(row(1, "t")), readRowInTheApplication(row("not a number", 2)), readPairInTheTestFile(pair(1, "r")), readPairInTheTestFile(pair(null, undefined)),
      JSON.stringify([payload(1), row(1, "t"), pair(1, "r")]), [payload(1), payloadOfThePackage(1)], [row(2, "u"), rowOfTheApplication(2, "u")], [pair(3, "s"), pairOfTheTestFile(3, "s")]]);
  });
  check(F, `what becomes of such a literal in ${where}`, () => {
    const payload = make(["v"], "return { value: v, issues: [] };");
    return warm(() => { const p = payload(1); p.issues.push("one"); p.value = { other: "type" }; p.added = true; const keys = Object.keys(p); delete p.value; const frozen = Object.freeze(payload(2)); return [p, keys, Object.keys(p), { ...p }, Object.getPrototypeOf(p) === Object.prototype, attempt(() => { "use strict"; frozen.value = 3; }), readPayloadInThePackage(frozen), structuredClone(payload(4)), Object.entries(payload(5))]; });
  });
  check(F, `instanceof classes of every image and built-in ones in ${where}`, () => {
    const is = make(["v", "C"], "return v instanceof C;");
    const values = [new Theirs(1), new Settings(1), new StaticsOfTheTestFile(), new Date(0), [], new Map(), new Error("e"), Promise.resolve(1), () => 1, {}, Object.create(null), 1, "s", null, undefined];
    const classes = [Theirs, Settings, StaticsOfTheTestFile, StaticsOfThePackage, StaticsOfTheApplication, Date, Array, Map, Error, Promise, Function, Object];
    return warm(() => classes.map(C => values.map(v => (is(v, C) ? 1 : 0)).join("")));
  });
  check(F, `instanceof behind changes in ${where}`, () => {
    const is = make(["v", "C"], "return v instanceof C;");
    return [class A { x = 1 }, function F(this: any) { this.x = 1; } as any].map((C: any) => {
      const v = new C(), seen = [warm(() => is(v, C))];
      Object.defineProperty(C, Symbol.hasInstance, { value: (x: unknown) => x === "chosen", configurable: true }); seen.push(is(v, C), is("chosen", C));
      delete C[Symbol.hasInstance]; seen.push(is(v, C)); Object.setPrototypeOf(v, null); seen.push(is(v, C));
      seen.push(attempt(() => is(v, {})) as any, attempt(() => is(v, 1)) as any);
      return seen;
    });
  });
  check(F, `what classes, functions and namespaces hold in ${where}`, () => {
    const read = make(["C"], "return [C.limit, C.label, typeof C.twice, C.twice && C.twice(), C.name, C.length, typeof C.prototype, C.nothing];");
    const has = make(["C"], "return ['limit' in C, 'nothing' in C, 'name' in C, 'call' in C];");
    const ofNamespace = make(["n"], "return [typeof n.codeFromText, typeof n.codeFromTextInTheMiddle, n.packageText, n.middleText, n.nothing, 'packageText' in n, 'middleText' in n];");
    const all = [StaticsOfThePackage, StaticsOfTheApplication, StaticsOfTheTestFile, class extends StaticsOfThePackage {}, class extends StaticsOfTheApplication { static limit = 9; }, readPayloadInThePackage, readRowInTheApplication, readPairInTheTestFile, Date, Math.max];
    const first = warm(() => [all.map(C => read(C)), all.map(C => has(C)), ofNamespace(merge), ofNamespace(settings)]);
    StaticsOfThePackage.limit = 30; StaticsOfTheApplication.limit = 40; StaticsOfTheTestFile.limit = 50;
    const second = all.map(C => read(C));
    StaticsOfThePackage.limit = 3; StaticsOfTheApplication.limit = 4; StaticsOfTheTestFile.limit = 5;
    return [first, second];
  });
  check(F, `ordinary objects below compiled ones in ${where}`, () => {
    const read = make(["o"], "return [o.value, o.id, o.left, o.a, o.n, o.own, o.nothing];"), write = make(["o", "v"], "o.value = v; o.id = v; o.own = v; return Object.keys(o);"), has = make(["o"], "return ['value' in o, 'id' in o, 'left' in o, 'nothing' in o];");
    const above = [payloadOfThePackage(1), rowOfTheApplication(2, "t"), pairOfTheTestFile(3, "r"), new Theirs(1), new Settings(1)];
    const below = above.map(holder => Object.create(holder));
    const first = warm(() => below.map(o => [read(o), has(o)]));
    (above[0] as any).value = "changed"; (above[1] as any).id = "changed"; delete (above[2] as any).left; (above[3] as any).a = { other: 1 };
    const second = below.map(o => [read(o), has(o)]);
    return [first, second, below.map(o => write(o, 7)), below.map(o => read(o)), above.map(o => read(o))];
  });
  check(F, `ordinary objects of many shapes at one site in ${where}`, () => {
    const read = make(["o"], "return o.x;"), write = make(["o", "v"], "o.x = v; return o.x;"), has = make(["o"], "return 'x' in o;");
    const shapes = Array.from({ length: 12 }, (_, i) => JSON.parse(`{"k${i}":0,"x":${i}}`)).concat([JSON.parse("{}"), Object.create({ x: "above" }), Object.create({ get x() { return "got"; }, set x(v) { (this as any).kept = v; } }), [], new Map(), () => 1]);
    return warm(() => [shapes.map(o => read(o)), shapes.map(o => has(o)), shapes.map((o, i) => write(o, i)), shapes.map(o => o.kept)]);
  });
}
