#!/usr/bin/env python3
"""typed-objects-as-host-options.py <folder>: ONE CASE A FOLDER: TYPED OBJECTS HANDED TO THE HOST AS OPTIONS, DESCRIPTORS, HANDLERS, ITERABLES, THENABLES: each in four forms: a typed literal, an instance of a class with fields, an instance whose members are getters on the prototype, an heir (Object.create) of the literal; optional members absent; extras; one program, against plain Bun."""
import os, sys
out = sys.argv[1]
ROWS = [
 # name, interface body, literal, use (o is the options object)
 ("number format", "style: string; currency: string; maximumFractionDigits?: number; notation?: string", '{ style: "currency", currency: "USD" }', 'new Intl.NumberFormat("en-US", o as any).format(1234.567)'),
 ("number format, more", "style: string; currency: string; maximumFractionDigits?: number; notation?: string", '{ style: "currency", currency: "EUR", maximumFractionDigits: 0, notation: "compact" }', 'new Intl.NumberFormat("en-US", o as any).format(1234567.891)'),
 ("date format", "timeZone: string; year: string; month: string; day?: string; hour12?: boolean", '{ timeZone: "UTC", year: "numeric", month: "long" }', 'new Intl.DateTimeFormat("en-US", o as any).format(new Date(86400000 * 400))'),
 ("to locale string", "minimumFractionDigits: number; useGrouping?: boolean", '{ minimumFractionDigits: 3 }', '(1234.5).toLocaleString("en-US", o as any)'),
 ("collator", "numeric: boolean; sensitivity?: string", '{ numeric: true }', '["a10", "a2", "A1"].sort(new Intl.Collator("en", o as any).compare).join()'),
 ("locale compare", "sensitivity: string; numeric?: boolean", '{ sensitivity: "base" }', '"a".localeCompare("A", "en", o as any)'),
 ("plural rules", "type: string", '{ type: "ordinal" }', 'new Intl.PluralRules("en", o as any).select(2)'),
 ("list format", "style: string; type: string", '{ style: "long", type: "disjunction" }', 'new (Intl as any).ListFormat("en", o).format(["a", "b", "c"])'),
 ("segmenter", "granularity: string", '{ granularity: "word" }', '[...new (Intl as any).Segmenter("en", o).segment("ab cd")].length'),
 ("a wrong option", "style: string", '{ style: "no such style" }', 'new Intl.NumberFormat("en-US", o as any).format(1)'),
 ("descriptor", "value: number; enumerable?: boolean; writable?: boolean; configurable?: boolean", '{ value: 5, enumerable: true }', 'JSON.stringify(Object.getOwnPropertyDescriptor(Object.defineProperty({}, "k", o), "k"))'),
 ("accessor descriptor", "get: () => number; enumerable: boolean; set?: (v: number) => void", '{ get: () => 7, enumerable: true }', '(Object.defineProperty({}, "k", o) as any).k'),
 ("a descriptor of both kinds", "get: () => number; value: number", '{ get: () => 7, value: 1 }', 'Object.defineProperty({}, "k", o)'),
 ("descriptors", "a: { value: number; enumerable: boolean }; b: { value: string; enumerable: boolean }", '{ a: { value: 1, enumerable: true }, b: { value: "x", enumerable: false } }', 'JSON.stringify(Object.defineProperties({}, o as any)) + JSON.stringify(Object.create(null, o as any))'),
 ("reflect", "a: number; b?: string", '{ a: 1 }', '[Reflect.get(o, "a"), Reflect.get(o, "b"), Reflect.has(o, "a"), Reflect.has(o, "b"), Reflect.has(o, "toString"), Reflect.get(o, "constructor") === Object, typeof Reflect.get(o, "hasOwnProperty")].join()'),
 ("error cause", "cause: string", '{ cause: "the cause" }', '(new Error("m", o) as any).cause'),
 ("array-like", "length: number; 0: string; 1: string", '{ length: 2, 0: "a", 1: "b" }', 'Array.from(o as any).join() + Array.prototype.slice.call(o, 1).join() + Array.prototype.map.call(o, (x: any) => x + x).join() + Array.prototype.indexOf.call(o, "b")'),
 ("apply with an array-like", "length: number; 0: number; 1: number", '{ length: 2, 0: 3, 1: 9 }', 'Math.max.apply(null, o as any) + Reflect.apply(Math.min, null, o as any)'),
 ("to JSON", "a: number; toJSON: () => string", '{ a: 1, toJSON: () => "by toJSON" }', 'JSON.stringify(o) + JSON.stringify({ in: o }) + JSON.stringify([o])'),
 ("value of", "valueOf: () => number", '{ valueOf: () => 86400000 }', 'new Date(o as any).toISOString() + (+(o as any) + 1) + `${(o as any) > 5}` + Math.abs(o as any) + [1, 2, 3].at(({ valueOf: () => 1 }) as any)'),
 ("to string", "toString: () => string", '{ toString: () => "text" }', '`${o}` + String(o) + ("" + o) + ({ text: 1 } as any)[o as any] + "a text b".indexOf(o as any) + encodeURIComponent(o as any) + new RegExp(o as any).source + parseInt(({ toString: () => "12" }) as any)'),
 ("a thenable", "then: (f: (v: number) => void) => void", '{ then: (f: (v: number) => void) => f(42) }', '(async () => [await (o as any), await Promise.resolve(o as any), (await Promise.all([o as any]))[0], await Promise.race([o as any])].join())()'),
 ("an iterator result", "next: () => { done: boolean; value: number }", '(() => { let n = 0; return { next: () => ({ done: ++n > 2, value: n }) }; })()', '[...({ [Symbol.iterator]: () => o } as any)].join() '),
 ("text decoder", "fatal: boolean; ignoreBOM?: boolean", '{ fatal: true }', '(() => { const d = new TextDecoder("utf-8", o); return d.fatal + "," + d.ignoreBOM + "," + (() => { try { return d.decode(new Uint8Array([255])); } catch (e) { return (e as Error).name; } })(); })()'),
 ("search params", "a: string; b: string", '{ a: "1", b: "x y" }', 'new URLSearchParams(o as any).toString()'),
 ("headers", "accept: string; 'x-more'?: string", '{ accept: "text/plain" }', 'JSON.stringify([...new Headers(o as any)])'),
 ("response", "status: number; statusText?: string; headers?: { a: string }", '{ status: 201, headers: { a: "b" } }', '(() => { const r = new Response("body", o as any); return [r.status, r.statusText, r.headers.get("a"), r.ok].join(); })()'),
 ("request", "method: string; body?: string; headers?: { a: string }", '{ method: "POST", body: "data" }', '(async () => { const r = new Request("http://localhost/x", o as any); return [r.method, await r.text(), r.headers.get("a")].join(); })()'),
 ("blob", "type: string", '{ type: "text/x-note" }', 'new Blob(["ab"], o).type'),
 ("structured clone", "a: number; b: { c: string }; d?: number", '{ a: 1, b: { c: "x" } }', 'JSON.stringify(structuredClone(o)) + Object.keys(structuredClone(o)).join()'),
 ("event listener options", "once: boolean; capture?: boolean", '{ once: true }', '(() => { const t = new EventTarget(); let n = 0; t.addEventListener("x", () => { n++; }, o); t.dispatchEvent(new Event("x")); t.dispatchEvent(new Event("x")); return n; })()'),
 ("handle event", "handleEvent: (e: Event) => void; seen: string[]", '(() => { const seen: string[] = []; return { seen, handleEvent: (e: Event) => { seen.push(e.type); } }; })()', '(() => { const t = new EventTarget(); t.addEventListener("x", o as any); t.dispatchEvent(new Event("x")); return o.seen.join(); })()'),
 ("custom event", "detail: { n: number }; bubbles?: boolean", '{ detail: { n: 5 } }', '(() => { const e = new CustomEvent("x", o); return e.detail.n + "," + e.bubbles + "," + (e.detail === o.detail); })()'),
 ("read file", "encoding: string; flag?: string", '{ encoding: "utf8" }', 'fs.readFileSync(import.meta.dir + "/note.txt", o).trim()'),
 ("read dir", "withFileTypes: boolean; recursive?: boolean", '{ withFileTypes: true }', 'fs.readdirSync(import.meta.dir + "/folder", o).map((d: any) => d.name + ":" + d.isFile()).join()'),
 ("mkdir", "recursive: boolean", '{ recursive: true }', '(() => { const p = import.meta.dir + "/made/a/b"; fs.mkdirSync(p, o); const r = fs.existsSync(p); fs.rmSync(import.meta.dir + "/made", { recursive: true }); return r; })()'),
 ("buffer", "type: string; data: number[]", '{ type: "Buffer", data: [104, 105] }', 'Buffer.from(o).toString()'),
 ("inspect", "depth: number; compact?: boolean; breakLength?: number", '{ depth: 0 }', 'util.inspect({ a: { b: { c: 1 } } }, o)'),
 ("inspected", "a: number; b: { c: string[] }; d?: number", '{ a: 1, b: { c: ["x"] } }', 'util.inspect(o) + " " + Bun.inspect(o) + " " + util.format("%j %o", o, o).length'),
 ("path format", "dir: string; base?: string; name?: string; ext?: string", '{ dir: "/a/b", name: "file", ext: ".txt" }', 'path.format(o)'),
 ("query string", "a: string; b: string[]; c?: number", '{ a: "1", b: ["x", "y"] }', 'querystring.stringify(o)'),
 ("url format", "protocol: string; hostname: string; pathname?: string; query?: { q: string }", '{ protocol: "https", hostname: "example.com", pathname: "/p", query: { q: "1" } }', 'url.format(o)'),
 ("deep equal", "a: number; b: { c: string }; d?: number", '{ a: 1, b: { c: "x" } }', '[util.isDeepStrictEqual(o, { a: 1, b: { c: "x" } }), Bun.deepEquals(o, { a: 1, b: { c: "x" } }), Bun.deepEquals(o, { a: 1, b: { c: "x" } }, true), (() => { try { assert.deepStrictEqual(o, { a: 1, b: { c: "x" } }); return "strict"; } catch { return "not strict"; } })(), (() => { try { assert.deepEqual(o, { a: 1, b: { c: "x" } }); return "loose"; } catch { return "not loose"; } })()].join()'),
 ("gzip", "level: number", '{ level: 1 }', 'zlib.gunzipSync(zlib.gzipSync(Buffer.from("aaaaaaaaaa"), o)).toString()'),
 ("spawn", "cmd: string[]; env?: { X: string }; stdout?: string", '{ cmd: ["/bin/echo", "spawned"], stdout: "pipe" }', 'Bun.spawnSync(o).stdout.toString().trim()'),
 ("readable", "objectMode: boolean; read: () => void", '{ objectMode: true, read() {} }', '(() => { const r = new stream.Readable(o); return r.readableObjectMode + "," + typeof r._read; })()'),
 ("emitter", "captureRejections: boolean", '{ captureRejections: true }', 'typeof new events.EventEmitter(o).on'),
 ("hash options", "outputLength: number", '{ outputLength: 8 }', 'crypto.createHash("shake128", o).update("a").digest("hex")'),
 ("file options", "type: string", '{ type: "text/x-note" }', 'Bun.file(import.meta.dir + "/note.txt", o).type'),
 ("sort by a typed comparator holder", "compare: (a: number, b: number) => number", '{ compare: (a: number, b: number) => b - a }', '[1, 3, 2].sort(o.compare).join() + [1, 3, 2].toSorted(o.compare).join()'),
 ("assign and spread by the host", "a: number; b?: string; c: number[]", '{ a: 1, c: [1] }', 'JSON.stringify(Object.assign({}, o)) + JSON.stringify(Object.entries(o)) + JSON.stringify(Object.fromEntries(Object.entries(o))) + JSON.stringify(Object.getOwnPropertyNames(o)) + JSON.stringify(Object.getOwnPropertyDescriptors(o)).length'),
]
head = '''declare const console: { log(...v: unknown[]): void }; declare const Bun: any; declare const Buffer: any; declare const require: any;
declare const TextDecoder: any, URLSearchParams: any, Headers: any, Response: any, Request: any, Blob: any, structuredClone: any, EventTarget: any, CustomEvent: any; declare class Event { constructor(t: string); type: string }
const fs = require("node:fs"), util = require("node:util"), path = require("node:path"), querystring = require("node:querystring"), url = require("node:url"), assert = require("node:assert"), zlib = require("node:zlib"), stream = require("node:stream"), events = require("node:events"), crypto = require("node:crypto");
const show = (v: unknown): string => typeof v === "string" ? v : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
async function row(name: string, f: () => unknown): Promise<void> { let text: string; try { text = show(await f()); } catch (e) { text = "THROWS " + (e as Error).name + ": " + String((e as Error).message).split("\\n")[0].slice(0, 90); } console.log(name + ": " + text); }
function viaGetters<T extends object>(from: T): T { const proto: any = {}; for (const k of Reflect.ownKeys(from)) Object.defineProperty(proto, k, { get() { return (from as any)[k]; }, enumerable: true, configurable: true }); return Object.create(proto); }
'''
body = []
for i, (name, iface, lit, use) in enumerate(ROWS):
    fields = []
    body.append('interface O%d { %s }' % (i, iface))
    body.append('const make%d = (): O%d => (%s);' % (i, i, lit))
    body.append('const use%d = (o: O%d): unknown => %s;' % (i, i, use))
    body.append('for (let round = 0; round < 2; round++) { await row(%r + " | literal", () => use%d(make%d())); await row(%r + " | heir", () => use%d(Object.create(make%d()))); await row(%r + " | getters", () => use%d(viaGetters(make%d()))); await row(%r + " | with an extra", () => { const o: any = make%d(); o.extraName = 1; return use%d(o); }); await row(%r + " | frozen", () => use%d(Object.freeze(make%d()))); await row(%r + " | a copy", () => use%d({ ...make%d() })); }' % (name, i, i, name, i, i, name, i, i, name, i, i, name, i, i, name, i, i))
os.makedirs(out + "/typed-objects-as-host-options/folder", exist_ok=True)
open(out + "/typed-objects-as-host-options/main.ts", "w").write(head + "\n".join(body) + "\n")
open(out + "/typed-objects-as-host-options/note.txt", "w").write("the text of a note\n"); open(out + "/typed-objects-as-host-options/folder/one.txt", "w").write("1\n")
print("1 program,", len(ROWS), "rows x 6 forms x 2 rounds")
