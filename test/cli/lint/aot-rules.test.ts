// The rules of `bun lint --aot`. Most of them need types, so each table is a project with a tsconfig.json and no ESLint config.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { unsupported } from "../../aot/run-programs";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

/** `«` and `»` are around what is reported. They are not part of the code. `ids`: the `messageId` of each report. */
type Case = string | { code: string; ids?: string[]; file?: string };
type Message = { ruleId: string; messageId: string; severity: number; line: number; column: number; endLine: number; endColumn: number };

const user = `export {};\ninterface User { id: number; name: string }\ndeclare const body: any;\ndeclare function greet(user: User): string;\ndeclare function double(n: number): number;\n`;

const entry = `interface Entry { path: string; hasMessages: boolean }\ninterface Output { text: string }\ninterface Config { depth: number; name: string }\ninterface Settings { config: Config; mode: string }\ntype Run = () => void;\ndeclare function open(entry: Entry): void;\nexport {};\n`;

const bunTest = `import { jest, spyOn, vi } from "bun:test";\n`;
const nodeTest = `import { mock, test } from "node:test";\n`;
const sinon = `import sinon from "sinon";\n`;

const rules: Record<string, Case[]> = {
  "aot-no-any-to-typed": [
    user + `const id: number = «body.id»;`,
    user + `const it: User = «body»;`,
    user + `let name: string;\nname = «body.name»;`,
    user + `let name = "";\nname ||= «body.name»;`,
    user + `let name: string | undefined;\nname ??= «body.name»;`,
    user + `double(«body.id»);\ngreet(«body»);`,
    user + `class Box { constructor(public size: number) {} }\nnew Box(«body.size»);`,
    user + `class Box { size: number = «body.size»; }`,
    user + `function nameOf(): string { return «body.name»; }`,
    user + `function h<T extends User>(value: any): T { return «value»; }`,
    user + `function h<T>(value: any): T[] { return «value»; }`,
    user + `const nameOf = (): string => «body.name»;`,
    user + `const it: User = { id: «body.id», name: "a" };`,
    user + `const id = body.id;\nconst it: User = { «id», name: "a" };`,
    user + `const ids: number[] = [«body.id», 2];`,
    user + `declare function sum(pair: [number, number]): number;\nsum([«body.a», 2]);`,
    user + `function* ids(): Generator<number> { yield «body.id»; }`,
    user + `function f(n: number = «body.id») { return n; }`,
    user + `const id: number = «body.ok ? body.id : 0»;`,
    user + `const id: number = «"4" as any»;`,
    { code: user + `const ids: number[] = [];\nids.push(«body.id»);`, ids: ["stored"] },
    { code: user + `const byName = new Map<string, number>();\nbyName.set("a", «body.id»);`, ids: ["stored"] },
    user + `const copy = body.id;`,
    user + `const copy: any = body.id;`,
    user + `const copy: unknown = body.id;`,
    user + `const id: number = body.id as number;`,
    user + `const id: number = Number(body.id);`,
    user + `console.log(body, String(body.id), JSON.stringify(body));`,
    user + `function same<T>(value: T): T { return value; }\nsame(body.id);`,
    user + `function f() { return body.id; }`,
    user + `function h<T>(value: any): T { return value; }`,
    user + `function h<T>(value: any): T | undefined { return value; }`,
    user + `function h<T>(value: any): T | number { return value; }`,
    user + `const it = { id: body.id };`,
    user + `Math.max(body.id);\n"a".padStart(body.id);`,
    user + `const id: number = 4;\ndouble(id);`,
    { code: `const body = JSON.parse("{}");\nfunction double(n) { return n * 2; }\ndouble(body.id);`, file: "plain.js" },
  ],
  "aot-outside-data": [
    user + `const it = «JSON.parse("{}") as User»;`,
    user + `const it = «body as User»;`,
    user + `const it = «body.user as User»;`,
    user + `function f(value: unknown) { return «value as User»; }`,
    user + `try { greet(body as any); } catch (error) { console.log((«error as Error»).message); }`,
    user + `declare function load(): Promise<any>;\nconst it = «(await load()) as User»;`,
    user + `const it = «body as unknown as User»;`,
    user + `interface Config { extra: any; make(): any; list: any[] }\nconst config = «JSON.parse("{}") as Config»;\nconst a = «config.extra as User»;\nconst b = «config.make() as User»;\nconst c = «config.list[0] as User»;\nfunction f(given: Config) { return «given.extra as User»; }\nf(config);`,
    user + `interface Config { extra: any }\nconst config = «JSON.parse("{}") as Config»;\nconst own: Config = { extra: 1 };\nconst a = «own.extra as User»;\nconst b = (own as any).other as User;\nconst c = (config as any).other as User;`,
    user + `const it = body as any;`,
    user + `const it = body as unknown;`,
    user + `interface Admin extends User { level: number }\nfunction f(it: User) { return it as Admin; }`,
    user + `const it = { id: 1, name: "a" } as User;`,
    user + `const it: User = { id: 1, name: "a" };\nconst loose = it as any;\nconst again = loose as User;`,
    user + `const n = 1 as number;`,
  ],
  "aot-cast-lacks-member": [
    // A member that compiled code keeps as a bare number or boolean.
    { code: entry + `const it = «{ path: "a" } as Entry»;`, ids: ["missing"] },
    { code: entry + `const it = «{ path: "a" } as unknown as Entry»;`, ids: ["missing"] },
    { code: entry + `const it = «{ path: "a" } as any as Entry»;`, ids: ["missing"] },
    { code: entry + `const it = «<Entry>{ path: "a" }»;`, ids: ["missing"] },
    { code: entry + `const it = «({ path: "a" } satisfies object) as Entry»;`, ids: ["missing"] },
    { code: entry + `const it = «{ name: "a" } as Config»;`, ids: ["missing"] },
    { code: entry + `const it = «{ path: "a" } as Entry | undefined»;`, ids: ["missing"] },
    { code: entry + `const it = «{ path: "a" } as Readonly<Entry> & { path: string }»;`, ids: ["missing"] },
    { code: entry + `const it = «{ path: "a" } as Readonly<Entry>»;`, ids: ["missing"] },
    { code: entry + `const it = «{ path: "a" } as Pick<Entry, "path" | "hasMessages">»;`, ids: ["missing"] },
    { code: entry + `interface Cell<T> { value: T; size: number }\nconst it = «{ value: "a" } as Cell<string>»;`, ids: ["missing"] },
    { code: entry + `interface Sized { size: number }\ninterface Named extends Sized { name: string }\nconst it = «{ name: "a" } as Named»;`, ids: ["missing"] },
    { code: entry + `let partial = { path: "a" };\nconst it = «partial as unknown as Entry»;`, ids: ["missing"] },
    { code: entry + `enum Level { Low, High }\ninterface Alert { level: Level; text: string }\nconst it = «{ text: "a" } as Alert»;`, ids: ["missing"] },
    { code: entry + `interface Row { id: number | null; name: string }\nconst it = «{ name: "a" } as Row»;`, ids: ["missing"] },
    { code: entry + `interface Step { size: 1 | 2; done: true; name: string }\nconst it = «{ name: "a", done: true } as Step»;`, ids: ["missing"] },
    { code: entry + `type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };\nconst it = «{ kind: "circle" } as Shape»;`, ids: ["missing"] },
    { code: entry + `const partial = { path: "a" };\nconst it = «partial as unknown as Entry»;`, ids: ["missing"] },
    // `as never` is held to what the place expects.
    { code: entry + `open(«{ path: "a" } as never»);`, ids: ["missing"] },
    { code: entry + `const it: Entry = «{ path: "a" } as never»;`, ids: ["missing"] },
    { code: entry + `function f(): Entry { return «{ path: "a" } as never»; }`, ids: ["missing"] },
    { code: entry + `const all: { first: Entry } = { first: «{ path: "a" } as never» };`, ids: ["missing"] },
    // A member of another kind.
    { code: entry + `const it = «{ text: 5 } as unknown as Output»;`, ids: ["wrongMember"] },
    { code: entry + `const it = «{ text: {} } as unknown as Output»;`, ids: ["wrongMember"] },
    { code: entry + `const it = «{ text() {} } as unknown as Output»;`, ids: ["wrongMember"] },
    { code: entry + `const it = «{ path: "a", hasMessages: "yes" } as unknown as Entry»;`, ids: ["wrongMember"] },
    { code: entry + `const it = «{ path: "a", hasMessages: null } as unknown as Entry»;`, ids: ["wrongMember"] },
    { code: entry + `const it = «{ path: "a", hasMessages: undefined } as unknown as Entry»;`, ids: ["wrongMember"] },
    { code: entry + `interface Job { run: Run }\nconst it = «{ run: {} } as unknown as Job»;`, ids: ["wrongMember"] },
    { code: entry + `interface Page { rows: number[] }\nconst it = «{ rows: {} } as unknown as Page»;`, ids: ["wrongMember"] },
    { code: entry + `interface Page { out: Output }\nconst it = «{ out: [] } as unknown as Page»;`, ids: ["wrongMember"] },
    { code: entry + `interface Page { out: Output }\nconst it = «{ out: "a" } as unknown as Page»;`, ids: ["wrongMember"] },
    // A literal inside the literal has to match whole.
    { code: entry + `const it = «{ config: { depth: 1 }, mode: "a" } as unknown as Settings»;`, ids: ["wrongMember"] },
    { code: entry + `const it = «{ config: { name: "a" }, mode: "a" } as unknown as Settings»;`, ids: ["wrongMember"] },
    { code: entry + `const it = «{ config: {}, mode: "a" } as unknown as Settings»;`, ids: ["wrongMember"] },
    { code: entry + `const all = «[{ depth: 1 }] as unknown as Config[]»;`, ids: ["wrongMember"] },
    { code: entry + `const all = «["a"] as unknown as number[]»;`, ids: ["wrongMember"] },
    { code: entry + `const all = «[1, "a"] as unknown as number[]»;`, ids: ["wrongMember"] },
    // A value that is never of the type.
    { code: entry + `const it = «"done" as unknown as Output»;`, ids: ["wrongValue"] },
    { code: entry + `const it = «5 as unknown as Output»;`, ids: ["wrongValue"] },
    { code: entry + `const it = «true as unknown as Output»;`, ids: ["wrongValue"] },
    { code: entry + `const it = «1n as unknown as Output»;`, ids: ["wrongValue"] },
    { code: entry + `const it = «\`a\${1}\` as unknown as Output»;`, ids: ["wrongValue"] },
    { code: entry + `const it = «"done" as any as Output»;`, ids: ["wrongValue"] },
    { code: entry + `const it = «5 as unknown as Output | undefined»;`, ids: ["wrongValue"] },
    { code: entry + `const it = «"a" as unknown as object»;`, ids: ["wrongValue"] },
    { code: entry + `const it = «"abc" as unknown as string[]»;`, ids: ["wrongValue"] },
    { code: entry + `const run = «"no" as unknown as Run»;`, ids: ["wrongValue"] },
    { code: entry + `type Make = new () => object;\nconst make = «5 as unknown as Make»;`, ids: ["wrongValue"] },
    { code: entry + `open(«"a" as never»);`, ids: ["wrongValue"] },
    { code: entry + `const all = «{ a: 1 } as unknown as string[]»;`, ids: ["wrongValue"] },
    { code: entry + `const run = «{ a: 1 } as unknown as Run»;`, ids: ["wrongValue"] },
    { code: entry + `const run = «[1] as unknown as Run»;`, ids: ["wrongValue"] },
    { code: entry + `const text = «{ toString() { return "a"; } } as unknown as string»;`, ids: ["wrongValue"] },
    { code: entry + `const text = «{ toString: () => "a" } as string»;`, ids: ["wrongValue"] },
    { code: entry + `const n = «[1] as unknown as number»;`, ids: ["wrongValue"] },
    { code: entry + `class Box { constructor(public size: number) {} grow() { this.size++; } }\nconst box = «{ size: 1 } as Box»;`, ids: ["wrongValue"] },
    { code: entry + `class Box { name = "a"; size = 1; }\nconst box = «{ size: 1 } as Box | undefined»;`, ids: ["wrongValue"] },
    { code: entry + `abstract class Base { abstract size: number; grow() {} }\nconst it = «{ size: 1 } as Base»;`, ids: ["wrongValue"] },
    // It matches.
    entry + `const it = { path: "a", hasMessages: true } as Entry;`,
    entry + `const it = { path: "a", hasMessages: true, more: 1 } as Entry;`,
    entry + `const it = { host: "a" } as { host: string; port?: number };`,
    entry + `const it = { path: "a" } as Partial<Entry>;`,
    entry + `type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };\nconst it = { kind: "circle", radius: 1 } as Shape;`,
    entry + `class Box { size = 1; }\nconst box = { size: 1 } as Box;`,
    entry + `const it = { a: 1 } as Record<string, number>;`,
    entry + `const it = { a: 1 } as { [key: string]: number };`,
    entry + `const it = { a: 1 } as object;`,
    entry + `const it = { a: 1 } as {};`,
    entry + `const it = "a" as unknown as { length: number };`,
    entry + `const it = "a" as unknown as {};`,
    entry + `const it = "a" as unknown as String;`,
    entry + `const it = "a" as unknown as Output | string;`,
    // What is missing is read as `undefined`, as in JavaScript.
    entry + `interface Response { servers: string[]; name: string; next: Output; run: Run; big: bigint }\nconst it = { name: "a" } as Response;`,
    entry + `interface Row { id: number | undefined; name: string }\nconst it = { name: "a" } as Row;`,
    entry + `interface Row { id: number | string; flag: number | boolean; name: string }\nconst it = { name: "a" } as Row;`,
    entry + `enum Color { Red = "red" }\ninterface Pen { color: Color; name: string }\nconst it = { name: "a" } as Pen;`,
    entry + `interface Row { id: any; more: unknown; name: string }\nconst it = { name: "a" } as Row;`,
    entry + `const it = { text: null } as unknown as Output;`,
    entry + `const it = { text: undefined } as unknown as Output;`,
    entry + `const it = [1, 2] as unknown as Output;`,
    // It is filled in later, or set later.
    entry + `const it = {} as Entry;`,
    entry + `const it = null as unknown as Entry;`,
    entry + `const it = undefined as unknown as Entry;`,
    // `as` converts from one primitive type to another, or throws. The build reports that.
    entry + `const n = "4" as unknown as number;`,
    entry + `const text = 4 as unknown as string;`,
    entry + `const flag = 0 as unknown as boolean;`,
    entry + `const big = "4" as unknown as bigint;`,
    entry + `const text = 4n as unknown as string;`,
    // The value is not written here.
    entry + `interface Node { kind: number }\ninterface Identifier extends Node { text: string }\nfunction f(node: Node) { return node as Identifier; }`,
    entry + `declare const body: any;\nconst it = body as Entry;`,
    entry + `function f(value: unknown) { return value as Entry; }`,
    entry + `const it = JSON.parse("{}") as Entry;`,
    entry + `declare const rest: object;\nconst it = { path: "a", ...rest } as Entry;`,
    entry + `declare const key: string;\nconst it = { path: "a", [key]: true } as Entry;`,
    entry + `let partial = { path: "a" };\npartial = { path: "b" };\nconst it = partial as unknown as Entry;`,
    entry + `const partial: { path: string } = { path: "a" };\nconst it = partial as unknown as Entry;`,
    entry + `function f(partial = { path: "a" }) { return partial as unknown as Entry; }`,
    entry + `const it = { path: "a", get hasMessages() { return "yes"; } } as unknown as Entry;`,
    // The type does not say what the value is.
    entry + `const it = { path: "a" } as const;`,
    entry + `const all = ["a"] as const;`,
    entry + `const it = { path: "a" } as any;`,
    entry + `const it = { path: "a" } as unknown;`,
    entry + `open({ path: "a" } as any);`,
    entry + `const it = { path: "a" } as never;`,
    entry + `console.log({ path: "a" } as never);`,
    entry + `function f<T>() { return { path: "a" } as T; }`,
    entry + `function f<T extends Entry>() { return { path: "a" } as T; }`,
    entry + `function f<T>() { return { path: "a" } as Entry & T; }`,
    entry + `const pair = [1] as unknown as [number, string];`,
    // What a declaration file says about an object is only expected of it.
    entry + `const it = "a" as unknown as Date;`,
    entry + `const it = { a: 1 } as unknown as Map<string, number>;`,
    entry + `const it = { a: 1 } as unknown as Promise<number>;`,
    entry + `const it = { status: "a" } as unknown as Response;`,
  ],
  "aot-locked-builtin-write": [
    // A prototype keeps its properties and gets no others.
    { code: `«Array.prototype.last» = function () {\n  return this[this.length - 1];\n};`, ids: ["add"] },
    { code: `«Array.prototype.push» = function () {};`, ids: ["replace"] },
    `«String.prototype.shout» = function () {};`,
    `«Object.prototype.should» = 1;`,
    `«Promise.prototype.done» = function () {};`,
    `«Uint8Array.prototype.last» = function () {};`,
    `«Array.prototype.count»++;\n--«Array.prototype.count»;`,
    `«Array.prototype.count» += 1;`,
    { code: `«delete Array.prototype.flat»;`, ids: ["delete"] },
    // Any other built-in object keeps its properties.
    { code: `«Date.now» = () => 0;`, ids: ["replace"] },
    `«Math.random» = () => 0.5;`,
    `«JSON.parse» = text => text;`,
    `«Object.keys» = () => [];`,
    `«Promise.resolve» = () => {};`,
    `«Error.captureStackTrace» = () => {};`,
    `«Math.max» += 1;`,
    `«delete JSON.parse»;`,
    `«delete Math.max»;`,
    `«Intl.DateTimeFormat» = function () {};`,
    `«Intl.DateTimeFormat.prototype.resolvedOptions» = () => ({});`,
    `«Intl.DateTimeFormat.prototype.added» = 1;`,
    `«WebAssembly.Module.prototype.added» = 1;`,
    // What it inherits from another built-in object is not stored over.
    `«Uint8Array.from» = () => {};`,
    `«Date.toString» = () => "";`,
    { code: `«TypeError.captureStackTrace» = () => {};`, ids: ["replace"] },
    `«Object.defineProperty»(Date, "toString", { value() {} });`,
    `«Object.assign»(Math, { toString() {} });`,
    `«parseInt.call» = () => {};`,
    `«Object.setPrototypeOf»(parseInt, {});`,
    `«Array.prototype.length» = 3;`,
    // The global variables that name them.
    { code: `«Date» = class {};`, ids: ["replace"] },
    `«Promise» = require("bluebird");`,
    `«parseInt» = Number;`,
    `«Date»++;`,
    `«globalThis.Date» = class {};`,
    `«globalThis["Date"]» = class {};`,
    "«globalThis[`Date`]» = class {};",
    `«global.Promise» = require("bluebird");`,
    `«self.Map» = class {};`,
    `«globalThis.parseInt» = Number;`,
    `«globalThis.globalThis.Date» = class {};`,
    `«self.self.Date» = class {};`,
    `«delete globalThis.Promise»;`,
    // However the object and the key are written.
    `«Array.prototype["last"]» = function () {};`,
    `«Array["prototype"]["last"]» = function () {};`,
    "«Array.prototype[`last`]» = function () {};",
    `«Date["now"]» = () => 0;`,
    `«globalThis.Array.prototype.last» = function () {};`,
    `«global.Date.now» = () => 0;`,
    `«self.Math.random» = () => 0.5;`,
    `«(Array.prototype as any).last» = function () {};`,
    `«(Date as any).now» = () => 0;`,
    `«(<any>Date).now» = () => 0;`,
    `«(globalThis as any).Date» = class {};`,
    `«(Array as any).prototype.last» = function () {};`,
    `«Array.prototype!.last» = function () {};`,
    `(«Date.now») = () => 0;`,
    `«\\u0041rray.prototype.last» = function () {};`,
    `«\\u0044ate» = class {};`,
    { code: `«Array.prototype[Symbol.iterator]» = function* () {};`, ids: ["replace"] },
    { code: `«Array.prototype[Symbol.toStringTag]» = "List";`, ids: ["add"] },
    { code: `for (const name of names) «Array.prototype[name]» = helpers[name];`, ids: ["change"] },
    { code: `«Array.prototype["@@iterator"]» = function () {};`, ids: ["change"] },
    `«Object.assign»(Array.prototype, { [Symbol.iterator]() {} });`,
    `«Object.defineProperties»(Array, { [Symbol.species]: { value: Array } });`,
    // Through the functions of Object, which throw.
    { code: `«Object.defineProperty»(Array.prototype, "last", { value() {} });`, ids: ["add"] },
    { code: `«Object.defineProperty»(Array.prototype, "push", { value() {} });`, ids: ["replace"] },
    `«Object.defineProperty»(Date, "now", { value: () => 0 });`,
    `«Object.defineProperty»(globalThis, "Date", { value: class {} });`,
    `«Object.defineProperty»(Map.prototype, "size", { get: () => 0 });`,
    `«Object.defineProperty»(Array, Symbol.species, { get: () => Array });`,
    { code: `«Object.defineProperty»(Array.prototype, name, { value() {} });`, ids: ["change"] },
    `«Object.defineProperties»(String.prototype, { shout: { value() {} } });`,
    `«Object.defineProperties»(Math, { scale: { value() {} }, max: { value() {} } });`,
    { code: `«Object.defineProperties»(String.prototype, descriptors);`, ids: ["change"] },
    `«Object.assign»(Array.prototype, { last() {} });`,
    `«Object.assign»(Array.prototype, helpers);`,
    `«Object.assign»(Math, { random: () => 0.5 });`,
    `«Object.assign»(Math, helpers, { random: () => 0.5 });`,
    `«Object.assign»(globalThis, { Date: class {} });`,
    { code: `«Object.setPrototypeOf»(Array.prototype, {});`, ids: ["setPrototype"] },
    `«Object.setPrototypeOf»(Date, {});`,
    `«Object.setPrototypeOf»(Math, null);`,
    `«globalThis.Object.defineProperty»(Array.prototype, "last", { value() {} });`,
    `«Object.defineProperty»(self.Array.prototype, "last", { value() {} });`,
    // Through those of Reflect, which return false.
    `«Reflect.defineProperty»(Array.prototype, "last", { value() {} });`,
    `«Reflect.set»(Date, "now", () => 0);`,
    `«Reflect.set»(globalThis, "Date", class {});`,
    `«Reflect.deleteProperty»(JSON, "parse");`,
    `«Reflect.setPrototypeOf»(Array.prototype, {});`,
    `«globalThis.Reflect.set»(Date, "now", () => 0);`,
    // The prototype of a built-in object.
    { code: `«Array.prototype.__proto__» = {};`, ids: ["setPrototype"] },
    `«Array.prototype.__proto__» = null;`,
    `«Date.__proto__» = {};`,
    `«Math.__proto__» = {};`,
    // Under another name.
    `const P = Array.prototype;\n«P.last» = function () {};`,
    `var ArrayProto = Array.prototype,\n  ObjProto = Object.prototype;\n«ArrayProto.last» = function () {};\n«delete ObjProto.toString»;`,
    `const P = Array.prototype;\n«Object.defineProperty»(P, "last", { value() {} });`,
    `const P = Array.prototype;\n«Object.assign»(P, P, { last: P });\n«P.last» = P.last || P.at;`,
    `const P = Array.prototype as any;\n«P.last» = function () {};`,
    `const P = Array.prototype;\n«(P as any).last» = function () {};`,
    `const P = Array.prototype;\nfunction patch() {\n  «P["last"]» = function () {};\n}`,
    // Wherever it is.
    `try {\n  «Date.now» = () => 0;\n} catch {}`,
    `function patch() {\n  «Date.now» = () => 0;\n}`,
    `const previous = («Date.now» = () => 0);`,
    // A test that does not keep it from running.
    `if (Array.prototype.flat) {\n  «Array.prototype.flat» = wrap(Array.prototype.flat);\n}`,
    `if (!Array.prototype.last) {\n  «Array.prototype.last» = function () {};\n}`,
    `if (!Array.prototype.flat || isBroken()) {\n  «Array.prototype.flat» = function () {};\n}`,
    `if (!Array.prototype.first) {\n  «Array.prototype.flat» = function () {};\n}`,
    `if (!it.flat) {\n  «Array.prototype.flat» = function () {};\n}`,
    `if (typeof Intl !== "function") «globalThis.Intl» = {};`,
    `if (typeof Temporal.Now !== "function") «Temporal.Now» = {};`,
    `if (typeof Bun !== "undefined") «Array.prototype.last» = function () {};`,
    `if (!Array.prototype.flat) {\n} else {\n  «Array.prototype.flat» = function () {};\n}`,
    `if (typeof Object.assign === "function") «Object.assign» = wrap(Object.assign);`,
    `Array.prototype.flat && («Array.prototype.flat» = function () {});`,
    `«Array.prototype.last» ||= function () {};`,
    `«Array.prototype.last» ??= function () {};`,
    `«Array.prototype.flat» &&= function () {};`,
    `«Array.prototype.last» = Array.prototype.last || function () {};`,
    `«Array.prototype.flat» = Array.prototype.flatMap || function () {};`,
    `const now = Date.now;\n«Date.now» = () => now() + 1;`,
    `const parse = Date.parse;\n«Date.now» = parse;`,
    `const Promise = require("bluebird");\n«globalThis.Promise» = Promise;`,
    `import Promise from "bluebird";\n«global.Promise» = Promise;`,
    `let now = Date.now;\nnow = () => 0;\n«Date.now» = now;`,
    `const { parse: now } = Date;\n«Date.now» = now;`,
    `const { now } = clock;\n«Date.now» = now;`,
    // Lines of packages.
    `«Function.prototype.toString» = makeBuiltIn(function toString() {\n  return (isCallable(this) && getInternalState(this).source) || inspectSource(this);\n}, "toString");`,
    `«Function.prototype.call$0» = function () {\n  return this();\n};`,
    `«Object.defineProperty»(Object.prototype, "should", {\n  set: shouldSetter,\n  get: shouldGetter,\n  configurable: true,\n});`,
    `«globalThis.Date» = ClockDate;`,
    { code: `«Array.prototype.last» = function () {};`, file: "plain.js" },
    { code: `"use strict";\n«Date.now» = function () {};`, file: "common.cjs" },

    // Something else of that name.
    `const Date = {};\nDate.now = () => 0;`,
    `function f(Array) {\n  Array.prototype.last = function () {};\n}`,
    `import { Date } from "./date";\nDate.now = () => 0;`,
    `class Map {}\nMap.prototype.last = function () {};`,
    `let Promise;\nPromise = require("bluebird");`,
    `function f(globalThis) {\n  globalThis.Date = class {};\n}`,
    `const global = {};\nglobal.Date = class {};`,
    `const Object = { defineProperty() {} };\nObject.defineProperty(Array.prototype, "last", {});`,
    `const Reflect = { set() {} };\nReflect.set(Date, "now", () => 0);`,
    `const Symbol = { species: "added" };\nObject.defineProperty(Array, Symbol.species, { value: 1 });`,
    `shim.Array.prototype.last = function () {};`,
    `shim.Date.now = () => 0;`,
    `globalThis["Array.prototype"].last = function () {};`,
    `globalThis[""].Date = class {};`,
    `Intl["Collator.prototype"].added = 1;`,
    `this.Date = class {};`,
    `exports.Promise = require("bluebird");`,
    `module.exports.Date = class {};`,
    // Bun has no `window`. What has that name is the program's.
    `window.Date = class {};`,
    `window.Array.prototype.last = function () {};`,
    // A constructor, a namespace and the global object can be given new properties.
    `Object.added = 1;`,
    `Math.clamp = (n, low, high) => Math.min(Math.max(n, low), high);`,
    `Array.last = list => list.at(-1);`,
    `Array.push = () => {};`,
    `Promise.delay = ms => new Promise(done => setTimeout(done, ms));`,
    `JSON.safeParse = () => {};`,
    `Intl.added = 1;`,
    `parseInt.added = 1;`,
    `globalThis.added = 1;`,
    `(globalThis as any).__app = {};`,
    `self.added = 1;\nself.added++;\ndelete self.added;`,
    `self.app.Date = class {};\nglobal.app.Array.prototype.last = function () {};`,
    `Object.defineProperty(self.app, "Date", { value: 1 });\nObject.assign(globalThis.app, { Date: 1 });`,
    `Math.clamp ||= () => 0;`,
    `Object.defineProperty(Math, "clamp", { value() {} });`,
    `Object.defineProperties(Math, { clamp: { value() {} } });`,
    `Object.assign(Math, { clamp() {} });`,
    `Object.assign(globalThis, { added: 1 });`,
    `Reflect.set(Math, "clamp", () => 0);`,
    `Reflect.defineProperty(Math, "clamp", { value() {} });`,
    // What Bun adds to JavaScript stays as it is.
    `setTimeout = () => 0;`,
    `globalThis.setTimeout = () => 0;`,
    `globalThis.fetch = async () => new Response();`,
    `structuredClone = value => value;`,
    `globalThis.process = {};`,
    `delete globalThis.fetch;`,
    `process.exit = () => {};`,
    `console.log = () => {};`,
    `performance.now = () => 0;`,
    `crypto.randomUUID = () => "";`,
    `Response.json = () => {};`,
    `URL.prototype.added = 1;`,
    `Buffer.prototype.added = 1;`,
    `EventTarget.prototype.on = function () {};`,
    `Object.defineProperty(globalThis, "fetch", { value() {} });`,
    `Object.defineProperty(URL.prototype, "added", { value: 1 });`,
    `Object.assign(console, { log() {} });`,
    // Settings.
    `Error.stackTraceLimit = 50;`,
    `Error.prepareStackTrace = (error, stack) => stack;`,
    `TypeError.stackTraceLimit = 50;`,
    `delete Error.stackTraceLimit;`,
    // What JavaScript itself refuses, or decides.
    `Math.PI = 3;`,
    `delete Math.PI;`,
    `Array.prototype = {};`,
    `Symbol.iterator = Symbol();`,
    `Number.MAX_SAFE_INTEGER = 1;`,
    `Uint8Array.BYTES_PER_ELEMENT = 2;`,
    `NaN = 1;\nundefined = 1;\nInfinity = 1;`,
    `globalThis.NaN = 1;`,
    `Map.prototype.size = 1;`,
    `Uint8Array.prototype.buffer = 1;`,
    `Intl.DateTimeFormat.prototype.format = () => "";`,
    `Date.name = "Clock";`,
    `Date.length = 1;`,
    `RegExp.input = "";`,
    `Object.prototype.__proto__ = {};`,
    `Object.setPrototypeOf(Object.prototype, {});`,
    `Object.defineProperty(Math, "PI", { value: 3 });`,
    `Reflect.set(Math, "PI", 3);`,
    // Nothing is there to delete.
    `delete Array.prototype.last;`,
    `delete Math.clamp;`,
    `delete globalThis.added;`,
    `delete Date.toString;`,
    `Reflect.deleteProperty(Math, "clamp");`,
    // What is there is stored again.
    `Array.prototype.flat = Array.prototype.flat;`,
    `Date.now = Date.now;`,
    `Array.prototype.flat = Array.prototype.flat || function () {};`,
    `Array.prototype.flat = Array.prototype.flat ?? function () {};`,
    `(Array.prototype as any).flat = (Array.prototype as any).flat || function () {};`,
    `globalThis.Promise = globalThis.Promise || require("bluebird");`,
    `globalThis.Promise = Promise;`,
    `const now = Date.now;\nafterEach(() => {\n  Date.now = now;\n});`,
    `const RealDate = Date;\nglobalThis.Date = RealDate;`,
    `const { now } = Date;\nDate.now = now;`,
    `const { now: original, parse } = Date;\nDate.now = original;`,
    `const { Date: RealDate } = globalThis;\nglobalThis.Date = RealDate;`,
    `var toString = Object.prototype.toString;\nObject.prototype.toString = toString;`,
    `Reflect.set(Math, "max", Math.max);`,
    `Object.setPrototypeOf(Array.prototype, Object.prototype);`,
    `Array.prototype.__proto__ = Object.prototype;`,
    // It only runs where the property is missing, and it is not.
    `if (!Array.prototype.flat) {\n  Array.prototype.flat = function () {};\n}`,
    `if (!Array.prototype.flat) Object.defineProperty(Array.prototype, "flat", { value() {} });`,
    `if (!Array.prototype.flat) {\n  Object.assign(Array.prototype, { flat() {} });\n}`,
    `if (typeof Object.assign !== "function") Object.assign = function () {};`,
    `if (typeof Object.assign != "function") {\n  Object.defineProperty(Object, "assign", { value() {} });\n}`,
    `if ("function" !== typeof Object.assign) Object.assign = function () {};`,
    `if (typeof Promise === "undefined") globalThis.Promise = require("bluebird");`,
    `if (typeof Promise === "undefined") Promise = require("bluebird");`,
    `if (typeof globalThis.Promise === "undefined") {\n  globalThis.Promise = require("bluebird");\n}`,
    `if (!globalThis.Promise) globalThis.Promise = require("bluebird");`,
    `if (Array.prototype.flat === undefined) Array.prototype.flat = function () {};`,
    `if (Array.prototype.flat === void 0) Array.prototype.flat = function () {};`,
    `if (Array.prototype.flat == null) Array.prototype.flat = function () {};`,
    `if (!("flat" in Array.prototype)) Array.prototype.flat = function () {};`,
    `if (!Array.prototype.hasOwnProperty("flat")) Array.prototype.flat = function () {};`,
    `if (!Object.hasOwn(Array.prototype, "flat")) Array.prototype.flat = function () {};`,
    `if (!Object.prototype.hasOwnProperty.call(Array.prototype, "flat")) Array.prototype.flat = function () {};`,
    `if (!Reflect.has(Array.prototype, "flat")) Array.prototype.flat = function () {};`,
    `if (!Array.prototype.flat && isEnabled()) Array.prototype.flat = function () {};`,
    `if (!Array.prototype.flat || !Array.prototype.flat) Array.prototype.flat = function () {};`,
    `if (Array.prototype.flat) {\n} else {\n  Array.prototype.flat = function () {};\n}`,
    `if (!(Array.prototype as any).flat) (Array.prototype as any).flat = function () {};`,
    `if (!Array.prototype["flat"]) Array.prototype.flat = function () {};`,
    `Array.prototype.flat || (Array.prototype.flat = function () {});`,
    `Array.prototype.flat ?? (Array.prototype.flat = function () {});`,
    `!Array.prototype.flat && (Array.prototype.flat = function () {});`,
    `Array.prototype.flat ? 0 : (Array.prototype.flat = function () {});`,
    `Array.prototype.flat ||= function () {};`,
    `Array.prototype.flat ??= function () {};`,
    `Array.prototype.last &&= function () {};`,
    `Error.prototype.message &&= "failed";`,
    `Error.prototype.name = "Failure";`,
    `if (!Error.prototype.message) Error.prototype.message = "failed";`,
    `Error.prototype.message ||= "failed";`,
    `TypeError.prototype.code = 1;`,
    `Array.prototype.hasOwnProperty ||= function () {};`,
    `if (typeof Intl !== "object") globalThis.Intl = {};`,
    `if (typeof Bun === "undefined") Array.prototype.last = function () {};`,
    `if (Array.prototype.last) Array.prototype.flat = function () {};`,
    `if ("last" in Array.prototype) Array.prototype.flat = function () {};`,
    `Promise ||= require("bluebird");`,
    `if (!String.prototype.trim) {\n  (function () {\n    String.prototype.trim = function () {};\n  })();\n}`,
    `const P = Array.prototype;\nif (!P.flat) P.flat = function () {};`,
    `if (!Array.prototype.flatMap) {\n  Array.prototype.flat = function () {};\n  Array.prototype.last = function () {};\n}`,
    `if (!Object.entries) {\n  Object.values = function () {};\n  Object.setPrototypeOf(Array.prototype, {});\n  for (const name of names) Array.prototype[name] = helpers[name];\n}`,
    `if (typeof Symbol === "undefined") {\n  globalThis.Symbol = function () {};\n  Array.prototype["@@iterator"] = function () {};\n}`,
    // What the program makes.
    `class A {}\nA.prototype.last = function () {};`,
    `class List extends Array {}\nList.prototype.last = function () {};\nList.from = () => {};`,
    `const list = [];\nlist.last = () => {};\nlist.push = () => {};`,
    `const date = new Date();\ndate.getTime = () => 0;`,
    `it.prototype.last = function () {};`,
    `this.prototype.last = function () {};`,
    `Object.defineProperty(it, "last", { value() {} });`,
    `Object.setPrototypeOf(A.prototype, Array.prototype);`,
    `Object.setPrototypeOf(it, Date.prototype);`,
    `Object.assign({}, Array.prototype);`,
    `Object.assign(it, Math);`,
    `Reflect.set(it, "now", Date);`,
    `Reflect.set(Date, "now", () => 0, it);`,
    `map.set(Date, 1);`,
    `it.defineProperty(Array.prototype, "last", {});\nit.assign(Array.prototype, { last() {} });`,
    `Object.defineProperty(exports, "Date", { value: 1 });\nObject.assign(exports, { Date: 1 });`,
    `it.__proto__ = Array.prototype;`,
    // What is no object is no prototype, and the global object can be given another.
    `Array.prototype.__proto__ = 5;`,
    `Array.prototype.__proto__ = "a";`,
    `Array.prototype.__proto__ = undefined;`,
    `globalThis.__proto__ = {};`,
    `Object.setPrototypeOf(globalThis, {});`,
    // Nothing of it changes.
    `Object.freeze(Array.prototype);`,
    `Object.seal(JSON);`,
    `Object.preventExtensions(Math);`,
    `const now = Date.now;`,
    `Array.prototype.slice.call(arguments);`,
    `const { now } = Date;`,
    // The key is not to be seen, and need not be one that is there.
    `Math[name] = () => 0;`,
    `globalThis[name] = 1;`,
    `delete Array.prototype[name];`,
    `Object.defineProperty(Math, name, { value() {} });`,
    `Object.assign(Math, helpers);`,
    `Object.assign(globalThis, helpers);`,
    `Object.assign(Math, { ...helpers });`,
    `Object.assign(Math, { [name]: 1 });`,
    `Object.defineProperty(Array, "@@species", { value: 1, writable: true });`,
    `Array["@@species"] = 1;`,
    `Object.assign(Array.prototype, {});`,
    `Object.assign(Array.prototype);`,
    // Another name that does not stay what it was, or is only read.
    `let P = Array.prototype;\nP = {};\nP.last = function () {};`,
    `const P = Array.prototype;\nP.slice.call(arguments);\nconst push = P.push;`,
    `const P = A.prototype;\nP.last = function () {};`,
    `const P = Array.prototype;\nit.last = P;\nit[P.length] = 1;\nObject.assign(it, P);\nif (!P.last) it.last = typeof P.last;`,
    // Types.
    `declare global {\n  interface Array<T> {\n    last(): T;\n  }\n}\nexport {};`,
    `interface Date {\n  added: number;\n}`,
  ],
  "aot-spy-on-builtin": [
    // spyOn() of bun:test replaces them from inside the test runner, with or without --aot.
    bunTest + `spyOn(Math, "random").mockReturnValue(0.5);`,
    bunTest + `spyOn(Date, "now").mockReturnValue(0);`,
    bunTest + `jest.spyOn(Date, "now");`,
    bunTest + `vi.spyOn(Date, "now");`,
    bunTest + `spyOn(JSON, "parse");`,
    bunTest + `spyOn(Object, "keys");`,
    bunTest + `spyOn(Promise, "resolve");`,
    bunTest + `spyOn(Intl, "DateTimeFormat");`,
    bunTest + `spyOn(Error, "captureStackTrace");`,
    bunTest + `spyOn(Array.prototype, "push");`,
    bunTest + `spyOn(Date.prototype, "getTime");`,
    bunTest + `spyOn(Promise.prototype, "then");`,
    bunTest + `spyOn(Object.prototype, "hasOwnProperty");`,
    bunTest + `spyOn(Intl.DateTimeFormat.prototype, "formatToParts");`,
    bunTest + `spyOn(Array.prototype, Symbol.iterator);`,
    bunTest + `spyOn(globalThis.Date, "now");`,
    bunTest + `spyOn(Date as any, "now");`,
    bunTest + "spyOn(Date, `now`);",
    bunTest + `const spy = spyOn(Math, "random");\nafterEach(() => spy.mockRestore());`,
    `spyOn(Math, "random");`,
    `jest.spyOn(Math, "random");`,
    `import * as t from "bun:test";\nt.spyOn(Math, "random");`,
    // mock.method() of node:test defines the property.
    { code: nodeTest + `«mock.method(Math, "random", () => 0.5)»;`, ids: ["spy"] },
    { code: nodeTest + `«mock.method(Date, "now", () => 0)»;`, ids: ["clock"] },
    nodeTest + `«mock.method(Array.prototype, "push")»;`,
    nodeTest + `«mock.method(Date, "toString")»;`,
    nodeTest + `«mock.method(globalThis, "parseInt")»;`,
    nodeTest + `«mock.getter(Map.prototype, "size", () => 0)»;`,
    nodeTest + `«mock.method(Map.prototype, "size", () => 0, { getter: true })»;`,
    nodeTest + `test("a", t => {\n  «t.mock.method(Math, "random", () => 0.5)»;\n});`,
    // So do the stubs of sinon.
    { code: sinon + `«sinon.stub(Math, "random")».returns(0.5);`, ids: ["spy"] },
    { code: sinon + `«sinon.stub(Date, "now")».returns(0);`, ids: ["clock"] },
    { code: sinon + `«sinon.stub(globalThis, "Date")»;`, ids: ["clock"] },
    sinon + `«sinon.spy(JSON, "parse")»;`,
    sinon + `«sinon.replace(Math, "random", () => 0.5)»;`,
    sinon + `«sinon.replaceGetter(Map.prototype, "size", () => 0)»;`,
    sinon + `const sandbox = sinon.createSandbox();\n«sandbox.stub(Array.prototype, "push")»;`,
    sinon + `«this.sandbox.stub(Date, "now")»;`,
    // Fake timers that are written in JavaScript replace `Date`.
    { code: sinon + `const clock = «sinon.useFakeTimers()»;`, ids: ["fakeTimers"] },
    sinon + `«sinon.useFakeTimers(0)»;`,
    sinon + `«sinon.useFakeTimers(new Date(2020, 0, 1))»;`,
    sinon + `«sinon.useFakeTimers(Date.now())»;`,
    sinon + `«sinon.useFakeTimers({ now: 0 })»;`,
    sinon + `«sinon.useFakeTimers({ toFake: ["setTimeout", "Date"] })»;`,
    sinon + `«sinon.useFakeTimers({ toFake: [] })»;`,
    sinon + `const sandbox = sinon.createSandbox();\n«sandbox.useFakeTimers()»;`,
    `const sinon = require("sinon");\n«sinon.useFakeTimers()»;`,
    `import FakeTimers from "@sinonjs/fake-timers";\n«FakeTimers.install()»;`,
    `import * as FakeTimers from "@sinonjs/fake-timers";\n«FakeTimers.install({ now: 0 })»;`,
    `const FakeTimers = require("@sinonjs/fake-timers");\n«FakeTimers.install()»;`,
    `const lolex = require("lolex");\n«lolex.install({ toFake: ["Date"] })»;`,
    { code: nodeTest + `«mock.timers.enable()»;`, ids: ["fakeTimers"] },
    nodeTest + `«mock.timers.enable({ apis: ["Date"] })»;`,
    nodeTest + `«mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 })»;`,
    nodeTest + `«mock.timers.enable({ now: 0 })»;`,
    nodeTest + `test("a", t => {\n  «t.mock.timers.enable()»;\n});`,

    // The fake timers of bun:test replace nothing.
    bunTest + `jest.useFakeTimers();\njest.setSystemTime(0);\njest.advanceTimersByTime(1000);\njest.useRealTimers();`,
    bunTest + `vi.useFakeTimers();\nvi.setSystemTime(new Date(2020, 0, 1));`,
    bunTest + `jest.useFakeTimers({ now: 0 });`,
    `import { setSystemTime } from "bun:test";\nsetSystemTime(new Date(2020, 0, 1));\nsetSystemTime();`,
    sinon + bunTest + `jest.useFakeTimers();\nvi.useFakeTimers();`,
    // What Bun adds to JavaScript.
    bunTest + `spyOn(console, "log");`,
    bunTest + `spyOn(process, "cwd");`,
    bunTest + `spyOn(process.stdout, "write");`,
    bunTest + `spyOn(performance, "now");`,
    bunTest + `spyOn(crypto, "randomUUID");`,
    bunTest + `spyOn(Bun, "file");`,
    bunTest + `spyOn(Buffer, "from");`,
    bunTest + `spyOn(URL.prototype, "toString");`,
    bunTest + `spyOn(globalThis, "fetch");`,
    bunTest + `spyOn(globalThis, "setTimeout");`,
    nodeTest + `mock.method(console, "log");`,
    nodeTest + `mock.method(globalThis, "setTimeout");`,
    sinon + `sinon.stub(console, "log");`,
    sinon + `sinon.stub(globalThis, "fetch");`,
    sinon + `sinon.stub(process, "exit");`,
    // It can also replace a global variable, and give an object a property that it inherits or lacks.
    bunTest + `spyOn(globalThis, "Date");`,
    bunTest + `spyOn(globalThis, "parseInt");`,
    bunTest + `spyOn(Date, "toString");`,
    bunTest + `spyOn(Uint8Array, "from");`,
    bunTest + `spyOn(Math, "clamp");`,
    bunTest + `spyOn(Array.prototype, "last");`,
    bunTest + `spyOn(Error, "stackTraceLimit");`,
    // It takes no accessor, with or without --aot.
    bunTest + `spyOn(Map.prototype, "size");`,
    // What the program makes.
    bunTest + `class Client {\n  get() {}\n}\nspyOn(Client.prototype, "get");\nspyOn(new Client(), "get");`,
    bunTest + `spyOn([], "push");`,
    bunTest + `spyOn(new Date(), "getTime");`,
    bunTest + `spyOn(api, "now");`,
    bunTest + `import * as clock from "./clock";\nspyOn(clock, "now");`,
    sinon + `sinon.stub(api, "now");\nsinon.stub();\nsinon.spy();\nsinon.spy(callback);`,
    nodeTest + `mock.method(api, "now");\nmock.fn();`,
    // Something else of that name.
    bunTest + `const Date = { now() {} };\nspyOn(Date, "now");`,
    bunTest + `function f(Math) {\n  spyOn(Math, "random");\n}`,
    `function spyOn() {}\nspyOn(Math, "random");`,
    `import { spyOn } from "./spies";\nspyOn(Math, "random");`,
    // The key is not to be seen.
    bunTest + `spyOn(Math, name);`,
    sinon + `sinon.stub(Math, name);`,
    // Nothing is there to stub, with or without --aot.
    sinon + `sinon.stub(Math, "clamp");`,
    sinon + `sinon.stub(Array.prototype, "last");`,
    nodeTest + `mock.method(Math, "clamp");`,
    // Other functions of these names.
    `text.replace(Date, "now");`,
    `text.replace(/a/g, "b");`,
    `router.method("GET", "/");`,
    `plugin.install();`,
    `import FakeTimers from "./fake-timers";\nFakeTimers.install();`,
    `feature.enable();`,
    `timers.enable();`,
    `clock.useFakeTimers();`,
    // Fake timers that leave `Date` alone, or whose configuration is not to be seen.
    sinon + `sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });`,
    sinon + `sinon.useFakeTimers({ now: 0, toFake: ["setInterval"] });`,
    sinon + `sinon.useFakeTimers(configuration);`,
    sinon + `sinon.useFakeTimers({ ...configuration });`,
    sinon + `sinon.useFakeTimers({ toFake: names });`,
    sinon + `sinon.useFakeTimers({ toFake: ["setTimeout", name] });`,
    `import FakeTimers from "@sinonjs/fake-timers";\nFakeTimers.install({ toFake: ["setTimeout"] });\nFakeTimers.createClock();`,
    nodeTest + `mock.timers.enable({ apis: ["setTimeout"] });`,
    nodeTest + `mock.timers.enable({ apis: ["setTimeout", "setInterval"], now: 0 });`,
    nodeTest + `mock.timers.enable(options);`,
    nodeTest + `mock.timers.enable({ apis: [] });`,
    nodeTest + `mock.timers.tick(1000);\nmock.timers.reset();`,
  ],
};

function marked(code: string, messages: Message[]) {
  const lines = code.split("\n");
  const offset = (line: number, column: number) =>
    lines.slice(0, line - 1).reduce((sum, it) => sum + it.length + 1, 0) + column - 1;
  const marks = messages
    .flatMap(it => [
      { at: offset(it.line, it.column), text: "«" },
      { at: offset(it.endLine, it.endColumn), text: "»" },
    ])
    .toSorted((a, b) => b.at - a.at || a.text.localeCompare(b.text));
  for (const { at, text } of marks) code = code.slice(0, at) + text + code.slice(at);
  return code;
}

const compilerOptions = { strict: true, target: "esnext", module: "esnext", moduleResolution: "bundler", noEmit: true, allowJs: true };

async function lint(files: Record<string, string>, args: string[], more: Record<string, boolean> = {}) {
  const tsconfig = JSON.stringify({ compilerOptions: { ...compilerOptions, ...more } });
  using dir = tempDir("aot-rules", { "tsconfig.json": tsconfig, ...files });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "-f", "json", ...args, "."],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (stdout === "") console.error(stderr);
  const parsed = JSON.parse(stdout);
  // With an oxlint config the report has oxlint's form.
  type OfOxlint = { code: string; filename: string; labels: { span: { line: number } }[] };
  const results: { filePath: string; messages: Message[] }[] = Array.isArray(parsed)
    ? parsed
    : (parsed.diagnostics as OfOxlint[]).map(it => ({
        filePath: "/" + it.filename,
        messages: [{ ruleId: it.code.replace(/^(\w+)\((.*)\)$/, "$1/$2"), line: it.labels[0].span.line } as Message],
      }));
  const of = (name: string) =>
    results.filter(it => it.filePath.replaceAll("\\", "/").endsWith("/" + name)).flatMap(it => it.messages);
  return { of, exitCode };
}

const tables = Object.entries(rules).map(([name, table]) => [name, table, {}] as const);
describe.concurrent.each(tables)("bun/%s", (name, table, more) => {
  test("reports", async () => {
    const rule = `bun/${name}`;
    const cases = table.map(it => (typeof it === "string" ? { code: it } : it));
    const file = (index: number) => cases[index].file ?? `case-${index}.ts`;
    const code = (index: number) => cases[index].code.replace(/[«»]/g, "");
    const { of } = await lint(
      {
        // It is on by default, and `aot-locked-builtin-write` leaves to it what it reports.
        "bunfig.toml": `[lint.rules]\n"${rule}" = "error"\n"no-global-assign" = "off"\n`,
        ...Object.fromEntries(cases.map((_, index) => [file(index), code(index)])),
      },
      [],
      more,
    );
    const found = cases.map((it, index) => {
      const messages = of(file(index)).filter(it => it.ruleId === rule);
      return { code: marked(code(index), messages), ids: it.ids && messages.map(it => it.messageId) };
    });
    expect(found).toEqual(cases.map(it => ({ code: it.code, ids: it.ids })));
  });
});

const both = user + `const id: number = body.id;\ndouble(body.id);\nfunction f(): number { return body.id; }\nfunction* g(): Generator<number> { yield body.id; }\nconst ids: number[] = [body.id];\n`;
const rulesAt = (messages: Message[]) => messages.filter(it => /unsafe-(a|r)|aot-/.test(it.ruleId)).map(it => `${it.line} ${it.ruleId}`);

const flatConfig = (rules: Record<string, string>) =>
  `export default [{
    files: ["**/*.ts"],
    languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } } },
    rules: ${JSON.stringify(rules)},
  }];`;

describe.concurrent("the switch", () => {
  test("--aot turns the rules on, as warnings", async () => {
    const { of, exitCode } = await lint({ "a.ts": both }, ["--aot"]);
    expect(rulesAt(of("a.ts"))).toEqual([6, 7, 8, 9, 10].map(line => `${line} bun/aot-no-any-to-typed`));
    expect(exitCode).toBe(0);
  });

  test("so does aot = true in bunfig.toml", async () => {
    const { of } = await lint({ "a.ts": both, "bunfig.toml": "[lint]\naot = true\n" }, []);
    expect(rulesAt(of("a.ts"))).toEqual([6, 7, 8, 9, 10].map(line => `${line} bun/aot-no-any-to-typed`));
  });

  test("without it they are off", async () => {
    const { of } = await lint({ "a.ts": both }, []);
    expect(rulesAt(of("a.ts"))).toEqual([]);
  });

  test("a rule can be turned off again", async () => {
    const { of } = await lint({ "a.ts": both, "bunfig.toml": `[lint.rules]\n"bun/aot-no-any-to-typed" = "off"\n` }, ["--aot"]);
    expect(rulesAt(of("a.ts"))).toEqual([]);
  });

  test("with every kind of config file", async () => {
    const rules = { "no-debugger": "warn" };
    const legacy = {
      root: true,
      parser: "@typescript-eslint/parser",
      parserOptions: { sourceType: "module" },
      rules,
      overrides: [{ files: ["*.ts"] }],
    };
    const configs = { ".eslintrc.json": legacy, ".oxlintrc.json": { rules } };
    const found = await Promise.all(
      Object.entries(configs).map(async ([name, config]) =>
        rulesAt((await lint({ "a.ts": both, [name]: JSON.stringify(config) }, ["--aot"])).of("a.ts")).toSorted(),
      ),
    );
    const flat = await lint({ "a.ts": both, "eslint.config.mjs": flatConfig(rules) }, ["--aot"]);
    const all = [6, 7, 8, 9, 10].map(line => `${line} bun/aot-no-any-to-typed`).toSorted();
    expect([...found, rulesAt(flat.of("a.ts")).toSorted()]).toEqual([all, all, all]);
  });

  test("a config file's setting for a rule wins", async () => {
    const code = user + `const it = body as User;\nconst byName = new Map<string, number>();\nconst size = byName.get("a")!;\ndouble(body.id);\n`;
    const rules = { "bun/aot-outside-data": "off", "bun/aot-no-any-to-typed": "error" };
    const { of, exitCode } = await lint({ "a.ts": code, "eslint.config.mjs": flatConfig(rules) }, ["--aot"]);
    expect(rulesAt(of("a.ts"))).toEqual(["9 bun/aot-no-any-to-typed"]);
    expect(exitCode).toBe(1);
  });

  test("typescript-eslint rules do not repeat what these rules report", async () => {
    const code =
      both +
      `declare function sum(all: number[]): number;\nsum([body.id]);\nfunction h(): number[] { return [body.id]; }\nconst it = body as User;\nconst copy = body.id;\n`;
    const more = ["--rule", "@typescript-eslint/no-unsafe-type-assertion: warn"];
    const { of } = await lint({ "a.ts": code }, ["--aot", "--type-aware", ...more]);
    const at = (messages: Message[]) => messages.filter(it => /unsafe-(a|r|t)|aot-/.test(it.ruleId)).map(it => `${it.line} ${it.ruleId}`);
    expect(at(of("a.ts"))).toEqual([
      ...[6, 7, 8, 9, 10, 12, 13].map(line => `${line} bun/aot-no-any-to-typed`),
      "14 bun/aot-outside-data",
      "15 @typescript-eslint/no-unsafe-assignment",
    ]);
  });

  test("an error of typescript-eslint stays an error", async () => {
    const code = user + `const id: number = body.id;\ndouble(body.id);\nfunction f(): number { return body.id; }\nconst it = body as User;\n`;
    const errors = ["assignment", "argument", "return", "type-assertion"].flatMap(it => ["--rule", `@typescript-eslint/no-unsafe-${it}: error`]);
    const at = (messages: Message[]) =>
      messages.filter(it => /unsafe-(a|r|t)|aot-/.test(it.ruleId)).map(it => `${it.line} ${it.severity} ${it.ruleId.replace(/.*\//, "")}`);
    const theirs = ["6 2 no-unsafe-assignment", "7 2 no-unsafe-argument", "8 2 no-unsafe-return", "9 2 no-unsafe-type-assertion"];
    const ours = [6, 7, 8].map(line => `${line} 1 aot-no-any-to-typed`).concat("9 1 aot-outside-data");
    const [without, beside, quiet] = await Promise.all(
      [[], ["--aot"], ["--aot", "--quiet"]].map(more => lint({ "a.ts": code }, ["--type-aware", ...errors, ...more])),
    );
    expect(at(without.of("a.ts"))).toEqual(theirs);
    expect(at(beside.of("a.ts")).toSorted()).toEqual([...theirs, ...ours].toSorted());
    expect(at(quiet.of("a.ts"))).toEqual(theirs);
    expect([without.exitCode, beside.exitCode, quiet.exitCode]).toEqual([1, 1, 1]);
  });

  test("inline comments that turn a rule on or off are honored", async () => {
    const code = user + `const id: number = body.id;\n`;
    const own = "bun/aot-no-any-to-typed";
    const [off, on, raised] = await Promise.all([
      lint({ "a.ts": code + `/* eslint ${own}: "off" */\n` }, ["--aot", "--type-aware"]),
      lint({ "a.ts": code + `/* eslint ${own}: "warn" */\n` }, ["--type-aware"]),
      lint({ "a.ts": code + `/* eslint @typescript-eslint/no-unsafe-assignment: "error" */\n` }, ["--aot", "--type-aware"]),
    ]);
    const at = (messages: Message[]) => messages.filter(it => /unsafe-a|aot-/.test(it.ruleId)).map(it => `${it.line} ${it.ruleId}`);
    expect(at(off.of("a.ts"))).toEqual(["6 @typescript-eslint/no-unsafe-assignment"]);
    expect(at(on.of("a.ts"))).toEqual([`6 ${own}`]);
    expect(at(raised.of("a.ts")).toSorted()).toEqual(["6 @typescript-eslint/no-unsafe-assignment", `6 ${own}`]);
    expect(raised.exitCode).toBe(1);
  });

  test("a comment that silences a typescript-eslint rule does not silence these rules", async () => {
    const code = user + `// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment\nconst id: number = body.id;\n// eslint-disable-next-line bun/aot-no-any-to-typed\nconst other: number = body.id;\n`;
    const { of } = await lint({ "a.ts": code }, ["--aot", "--type-aware"]);
    expect(rulesAt(of("a.ts"))).toEqual(["7 bun/aot-no-any-to-typed"]);
  });
});

describe.concurrent("bun/aot-spy-on-builtin", () => {
  const own = "bun/aot-spy-on-builtin";
  const doubles = [
    `mock.method(Math, "random", () => 0.5);`,
    `mock.getter(Map.prototype, "size", () => 0);`,
    `sinon.stub(Math, "random");`,
    `sinon.replace(Math, "random", () => 0.5);`,
    `sinon.useFakeTimers();`,
    `mock.timers.enable();`,
  ];
  const others = [
    `spyOn(Math, "random");`,
    `jest.spyOn(Date, "now");`,
    `"a".replace("a", "b");`,
    `text.replace(Math, "random");`,
    `replace(Math, "random", () => 0.5);`,
    `router.method(app, "get");`,
    `plugin.install();`,
    `feature.enable();`,
    `it.hasOwnProperty(name);`,
  ];

  test.each([own, "no-prototype-builtins"])(
    "alone or beside a rule that listens to calls by name it reports every place: %s",
    async beside => {
      const legacy = { root: true, parser: "@typescript-eslint/parser", rules: { [own]: "warn", [beside]: "warn" } };
      const code = [...doubles, ...others].join("\n");
      const { of } = await lint({ "a.js": code, ".eslintrc.json": JSON.stringify(legacy) }, []);
      const found = of("a.js").filter(it => it.ruleId === own);
      expect(found.map(it => it.line)).toEqual(doubles.map((_, index) => index + 1));
    },
  );
});

describe.concurrent("bun/aot-locked-builtin-write", () => {
  const writes = [
    `Array.prototype.last = function () {};`,
    `Array["prototype"].count += 1;`,
    `Object.defineProperty(Array.prototype, "last", {});`,
    `Object.defineProperties(Array.prototype, { last: {} });`,
    `Date = class {};`,
    `Date++;`,
    `globalThis.Array.prototype.last = function () {};`,
    `Object.assign(Array.prototype, { last() {} });`,
    `Reflect.defineProperty(Array.prototype, "last", {});`,
    `delete Array.prototype.flat;`,
    `Array.prototype.count++;`,
    `globalThis.Date = class {};`,
    `Date.now = () => 0;`,
  ].join("\n");
  const own = "bun/aot-locked-builtin-write";
  const rulesAt = (messages: Message[]) =>
    messages.filter(it => /aot-|no-extend-native|no-global-assign/.test(it.ruleId)).map(it => `${it.line} ${it.ruleId}`);
  const bunfig = (twins: string) =>
    `[lint.rules]\n"${own}" = "warn"\n"no-extend-native" = "${twins}"\n"no-global-assign" = "${twins}"\n`;

  test("a place that no-extend-native or no-global-assign reports is reported once", async () => {
    const { of } = await lint({ "a.js": writes, "bunfig.toml": bunfig("warn") }, []);
    expect(rulesAt(of("a.js"))).toEqual([
      ...[1, 2, 3, 4].map(line => `${line} no-extend-native`),
      ...[5, 6].map(line => `${line} no-global-assign`),
      ...[7, 8, 9, 10, 11, 12, 13].map(line => `${line} ${own}`),
    ]);
  });

  test("without them it reports every place", async () => {
    const { of } = await lint({ "a.js": writes, "bunfig.toml": bunfig("off") }, []);
    expect(rulesAt(of("a.js"))).toEqual(writes.split("\n").map((_, index) => `${index + 1} ${own}`));
  });

  test.each([own, "bun/aot-spy-on-builtin", "no-prototype-builtins"])(
    "alone or beside a rule that listens to calls by name it reports every place: %s",
    async beside => {
      const legacy = { root: true, parser: "@typescript-eslint/parser", rules: { [own]: "warn", [beside]: "warn" } };
      const code = writes + "\nit.hasOwnProperty(name);\n";
      const { of } = await lint({ "a.js": code, ".eslintrc.json": JSON.stringify(legacy) }, []);
      expect(rulesAt(of("a.js"))).toEqual(writes.split("\n").map((_, index) => `${index + 1} ${own}`));
    },
  );

  // After an upgrade of JavaScriptCore: bun src/sema/check/aot/generate-locked-builtins.mjs
  test.skipIf(!!unsupported)("its table of built-in objects matches this engine", async () => {
    await using proc = spawn({
      cmd: [bunExe(), join(import.meta.dir, "../../../src/sema/check/aot/generate-locked-builtins.mjs"), "--check"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }, 120_000);
});
