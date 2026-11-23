#!/usr/bin/env python3
# generate-calls-out-of-slow-versions.py <folder>: one-shape programs: `outer(box)` leans on its parameter, so it has a guard and a slow version, which is written straight;
# it is called with what is written, then with what is not (another shape, a text, null's neighbor): THE SLOW VERSION RUNS, and in it stands one call of one shape of callee. The reference is `bun <file>`.
import os, sys
root = sys.argv[1]; os.makedirs(root, exist_ok=True)
head = """interface Box { v: number; w: number }
const log: string[] = [];
function note(text: string): number { log.push(text); return log.length; }
"""
tail = """
function show(run: () => unknown) { try { console.log(String(run())); } catch (e) { console.log("thrown", (e as Error).name, (e as Error).message.length > 0); } }
const fits: Box = { v: 3, w: 4 };
for (let i = 0; i < 3; i++) show(() => outer(fits));
show(() => outer(JSON.parse('{"z":1,"v":5,"w":6}')));
show(() => outer({ w: 8, v: 7, more: true } as any));
show(() => (outer as any)("text"));
show(() => (outer as any)({ v: "s", w: 1.5 }));
show(() => (outer as any)({ get v() { return note("getter"); }, w: 2 }));
show(() => (outer as any)(undefined));
console.log(log.join());
"""
def outer(body): return "function outer(box: Box): unknown {\n    let work = 0; for (let i = 0; i < 2; i++) work = (work + box.v + box.w) | 0;\n" + body + "\n}\n"
shapes = {
 "all-arguments-given": ("function callee(a: number, b: number) { return a * 10 + b; }", "    return callee(box.v, box.w) + work;"),
 "fewer-arguments": ("function callee(a: number, b?: number) { return b === undefined ? a + 100 : a + b; }\nnote(String(callee(1, 2)));", "    return callee(box.v) + work;"),
 "fewer-arguments-with-a-default": ("function callee(a: number, b = 7, c: number = a + b) { return a * 100 + b * 10 + c; }", "    return callee(box.v) + work;"),
 "fewer-arguments-than-are-written": ("function callee(a: number, b: number) { return (b as unknown) === undefined ? a + 100 : a + b; }\nnote(String(callee(1, 2)));", "    return (callee as any)(box.v) + work;"),
 "no-arguments": ("function callee(a?: number) { return typeof a; }", "    return callee() + work;"),
 "more-arguments": ("function callee(a: number) { return a + 1; }", "    return (callee as any)(box.v, note('second'), note('third')) + work;"),
 "this-is-read": ("function callee(this: unknown, a: number) { return typeof this + a; }", "    return callee(box.v) + work;"),
 "this-is-given": ("function callee(this: unknown, a: number) { return typeof this + a; }", "    return callee.call(box, box.v) + work;"),
 "a-rest-parameter": ("function callee(a: number, ...rest: number[]) { return a + rest.length * 10 + (rest[1] ?? 0); }", "    return callee(box.v, box.w, 5) + callee(box.v) + work;"),
 "the-arguments-object": ("function callee(a: number) { return arguments.length * 10 + a + (arguments[1] ?? 0); }", "    return (callee as any)(box.v, box.w) + callee(box.v) + work;"),
 "a-capture": ("function make(k: number) { return function callee(a: number) { return a + k; }; }\nconst callee = make(40);", "    return callee(box.v) + work;"),
 "an-arrow-in-a-constant": ("const callee = (a: number) => a + 2;", "    return callee(box.v) + work;"),
 "a-declaration-that-is-stored-into": ("function callee(a: number) { return a + 1; }\nfunction replace() { (callee as any) = function (a: number) { return a + 1000; }; }", "    const first = callee(box.v); if (box.w === 6) replace(); return first + callee(box.v) + work;"),
 "a-declaration-that-is-stored-into-at-the-start": ("function callee(a: number) { return a + 1; }\n(callee as any) = function (a: number) { return a + 2000; };", "    return callee(box.v) + work;"),
 "a-declaration-of-another-module-s-kind": ("function callee(a: number) { return a + 1; }\nconst alias = callee;", "    return alias(box.v) + callee(box.w) + work;"),
 "replaced-at-run-time": ("let callee = function (a: number) { return a + 1; };\nfunction replace() { callee = function (a: number) { return a + 1000; }; }", "    const first = callee(box.v); if (box.w === 6) replace(); return first + callee(box.v) + work;"),
 "replaced-by-unseen-code": ("let callee = function (a: number) { return a + 1; };\n(globalThis as any).replace = (f: any) => { callee = f; };", "    if (box.w === 8) (globalThis as any).replace((a: number) => a + 5000); return callee(box.v) + work;"),
 "it-throws": ("function callee(a: number): number { if (a > 4) throw new RangeError('above ' + a); return a; }", "    try { return callee(box.v) + work; } catch (e) { return 'caught ' + (e as Error).message + note('handler'); }"),
 "it-throws-past-the-caller": ("function callee(a: number): number { if (a > 4) throw new RangeError('above ' + a); return a; }", "    return callee(box.v) + work;"),
 "it-returns-a-boolean": ("function callee(a: number) { return a > 4; }", "    return callee(box.v) ? work + 1 : work - 1;"),
 "it-returns-a-double": ("function callee(a: number) { return a / 4; }", "    return callee(box.v) + work;"),
 "it-returns-nothing": ("function callee(a: number) { note('ran ' + a); }", "    return String(callee(box.v)) + work;"),
 "it-returns-an-object": ("function callee(a: number) { return { a, twice: a * 2 }; }", "    return callee(box.v).twice + work;"),
 "it-takes-integers-alone": ("function callee(a: number, b: number) { return (a | 0) + (b | 0); }", "    return callee(1, 2) + callee(work | 0, 3);"),
 "it-takes-a-double": ("function callee(a: number) { return a * 2; }", "    return callee(0.5) + callee(work + 0.25);"),
 "it-takes-what-the-caller-was-handed": ("function callee(b: Box) { return b.v + b.w; }", "    return callee(box) + work;"),
 "it-calls-the-caller-again": ("function callee(b: Box, depth: number): unknown { return depth ? outerAgain(b, depth - 1) : b.v; }\nfunction outerAgain(box: Box, depth: number): unknown { let work = 0; for (let i = 0; i < 2; i++) work = (work + box.v) | 0; return callee(box, depth); }", "    return String(outerAgain(box, 3)) + work;"),
 "an-async-function": ("async function callee(a: number) { return a + 1; }", "    callee(box.v).then((value) => console.log('later', value)); return work;"),
 "a-generator": ("function* callee(a: number) { yield a + 1; }", "    return callee(box.v).next().value + work;"),
 "a-class-is-called": ("class callee { constructor(public a: number) { } }", "    return (callee as any)(box.v) + work;"),
 "a-constant-in-its-dead-zone": ("function early(box: Box) { return outer(box); }\nshowEarly();\nfunction showEarly() { try { console.log(String(early('text' as any))); } catch (e) { console.log('early', (e as Error).name); } }\nconst callee = (a: number) => a + 2;", "    return callee(box.v) + work;"),
 "two-calls-share-the-read": ("function callee(a: number) { return a + 1; }", "    const f = callee; return f(box.v) + f(box.w) + (typeof f).length + work;"),
 "the-callee-is-also-handed-on": ("function callee(a: number) { return a + 1; }", "    return [box.v, box.w].map(callee).join() + callee(box.v) + work;"),
 "arguments-in-order": ("function callee(a: number, b: number, c: number) { return a * 100 + b * 10 + c; }", "    return callee(note('a'), note('b'), note('c')) + work;"),
 "seven-arguments": ("function callee(a: number, b: number, c: number, d: number, e: number, f: number, g: number) { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7; }", "    return callee(box.v, box.w, 1, 2, 3, 4, 5) + work;"),
 "in-a-loop": ("function callee(a: number, b: number) { return a + b; }", "    let sum = 0; for (let i = 0; i < 5; i++) sum = callee(sum, box.v) as number; return sum + work;"),
 "its-result-is-an-argument": ("function callee(a: number) { return a + 1; }", "    return callee(callee(callee(box.v))) + work;"),
}
for name, (declared, body) in shapes.items():
    text = head + (declared + "\n" + outer(body) if name != "a-constant-in-its-dead-zone" else outer(body) + declared + "\n") + tail
    open(os.path.join(root, name + ".ts"), "w").write(text)
print(len(shapes), "programs")
