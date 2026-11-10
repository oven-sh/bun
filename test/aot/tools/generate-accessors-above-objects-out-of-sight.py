#!/usr/bin/env python3
# generate-accessors-above-objects-out-of-sight.py <folder>: all 1,320; ../parallel/accessors-above-objects-out-of-sight/ holds 7 of them: one-shape programs: an accessor stands above an object whose layout has left; a reader or a writer in a loop runs it; a deed between two rounds changes what the name finds.
# makers x uses x deeds. Every observer is a primitive. The reference is `bun <file>`.
import os, sys
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

# Each maker gives: the text that declares, `make(n)`, the holder of the accessor (`HOLDER`), and the prototype object that stands right above the objects (`NEAREST`).
makers = {
 'class': ('class Temp { c: number; constructor(c: number) { this.c = c; } get f() { return this.c * 2; } set f(v: number) { this.c = v / 2; } }\nfunction make(n: number): any { return new Temp(n); }', 'Temp.prototype', 'Temp.prototype'),
 'class-getter-alone': ('class Temp { c: number; constructor(c: number) { this.c = c; } get f() { return this.c * 2; } }\nfunction make(n: number): any { return new Temp(n); }', 'Temp.prototype', 'Temp.prototype'),
 'class-setter-alone': ('class Temp { c: number; constructor(c: number) { this.c = c; } set f(v: number) { this.c = v / 2; } }\nfunction make(n: number): any { return new Temp(n); }', 'Temp.prototype', 'Temp.prototype'),
 'class-below-class': ('class Base { c: number; constructor(c: number) { this.c = c; } get f() { return this.c * 2; } set f(v: number) { this.c = v / 2; } }\nclass Temp extends Base { d = 1; }\nfunction make(n: number): any { return new Temp(n); }', 'Base.prototype', 'Temp.prototype'),
 'function-one-descriptor': ('function Temp(this: any, c: number) { this.c = c; }\nObject.defineProperty(Temp.prototype, "f", { get: function (this: any) { return this.c * 2; }, set: function (this: any, v: number) { this.c = v / 2; }, enumerable: true, configurable: true });\nfunction make(n: number): any { return new (Temp as any)(n); }', 'Temp.prototype', 'Temp.prototype'),
 'function-one-descriptor-getter-alone': ('function Temp(this: any, c: number) { this.c = c; }\nObject.defineProperty(Temp.prototype, "f", { get: function (this: any) { return this.c * 2; }, configurable: true });\nfunction make(n: number): any { return new (Temp as any)(n); }', 'Temp.prototype', 'Temp.prototype'),
 'function-map-of-descriptors': ('function Temp(this: any, c: number) { this.c = c; }\nObject.defineProperties(Temp.prototype, { f: { get: function (this: any) { return this.c * 2; }, set: function (this: any, v: number) { this.c = v / 2; }, configurable: true } });\nfunction make(n: number): any { return new (Temp as any)(n); }', 'Temp.prototype', 'Temp.prototype'),
 'function-methods-in-the-descriptor': ('function Temp(this: any, c: number) { this.c = c; }\nObject.defineProperty(Temp.prototype, "f", { get(this: any) { return this.c * 2; }, set(this: any, v: number) { this.c = v / 2; }, configurable: true });\nfunction make(n: number): any { return new (Temp as any)(n); }', 'Temp.prototype', 'Temp.prototype'),
 'function-descriptor-written-twice': ('function Temp(this: any, c: number) { this.c = c; }\nObject.defineProperty(Temp.prototype, "f", { get: function (this: any) { return this.c * 3; }, configurable: true });\nObject.defineProperty(Temp.prototype, "f", { get: function (this: any) { return this.c * 2; }, set: function (this: any, v: number) { this.c = v / 2; }, configurable: true });\nfunction make(n: number): any { return new (Temp as any)(n); }', 'Temp.prototype', 'Temp.prototype'),
 'function-getter-with-a-capture': ('function Temp(this: any, c: number) { this.c = c; }\n{ let factor = 2; Object.defineProperty(Temp.prototype, "f", { get: function (this: any) { return this.c * factor; }, set: function (this: any, v: number) { this.c = v / factor; factor = 2; }, configurable: true }); }\nfunction make(n: number): any { return new (Temp as any)(n); }', 'Temp.prototype', 'Temp.prototype'),
}

uses = {
 'read': 'function use(o: any): string { let sum = 0; for (let k = 0; k < 3; k++) sum += Number(o.f); return String(sum); }',
 'store': 'function use(o: any): string { for (let k = 0; k < 3; k++) o.f = 8 + k; return String(o.c); }',
 'strict-store': 'function use(o: any): string { "use strict"; let thrown = 0; for (let k = 0; k < 3; k++) { try { o.f = 8 + k; } catch { thrown++; } } return o.c + "," + thrown; }',
 'compound': 'function use(o: any): string { for (let k = 0; k < 3; k++) o.f += 2; return String(o.c); }',
 'read-in-what-a-loop-calls': 'function once(o: any): unknown { return o.f; }\nfunction use(o: any): string { let seen = ""; for (let k = 0; k < 3; k++) seen += String(once(o)) + " "; return seen; }',
 'read-once': 'function use(o: any): string { return String(o.f); }',
}

deeds = {
 'nothing': '',
 'the-getter-is-replaced': 'Object.defineProperty(HOLDER, "f", { get() { return 100; }, configurable: true });',
 'the-setter-is-replaced': 'Object.defineProperty(HOLDER, "f", { set(this: any, v: number) { this.c = -v; }, configurable: true });',
 'unseen-code-replaces-the-getter': '(globalThis as any).holder = HOLDER; (0, eval)("Object.defineProperty(holder, \'f\', { get() { return 100; }, configurable: true })");',
 'a-value-replaces-the-accessor': 'Object.defineProperty(HOLDER, "f", { value: 100, writable: true, configurable: true });',
 'the-accessor-is-deleted': 'delete (HOLDER as any).f;',
 'the-object-gets-a-value-of-its-own': 'Object.defineProperty(first, "f", { value: 100, writable: true, configurable: true });',
 'the-object-gets-an-accessor-of-its-own': 'Object.defineProperty(first, "f", { get() { return 100; }, set(v) { (this as any).c = -v; }, configurable: true });',
 'unseen-code-gives-the-object-a-value-of-its-own': '(0, eval)("Object.defineProperty(kept, \'f\', { value: 100, writable: true, configurable: true })");',
 'the-object-is-relinked': 'Object.setPrototypeOf(first, { get f() { return 100; }, set f(v: number) { (this as any).c = -v; } });',
 'the-object-is-relinked-below-null': 'Object.setPrototypeOf(first, null);',
 'unseen-code-relinks-the-object': '(0, eval)("Object.setPrototypeOf(kept, { get f() { return 100; }, set f(v) { this.c = -v; } })");',
 'the-nearest-prototype-gets-the-name': 'Object.defineProperty(NEAREST, "f", { get() { return 100; }, set(this: any, v: number) { this.c = -v; }, configurable: true });',
 'the-nearest-prototype-is-relinked': 'Object.setPrototypeOf(NEAREST, { get f() { return 100; }, set f(v: number) { (this as any).c = -v; } });',
 'the-object-is-frozen': 'Object.freeze(first);',
 'the-object-takes-no-new-names': 'Object.preventExtensions(first);',
 'another-object-of-the-class-gets-a-value-of-its-own': 'Object.defineProperty(second, "f", { value: 100, writable: true, configurable: true });',
 'the-field-is-deleted': 'delete first.c;',
 'the-maker-gives-what-it-makes-a-value-of-its-own': 'during = 1;',
 'the-maker-gives-what-it-makes-an-accessor-of-its-own': 'during = 2;',
 'the-maker-relinks-what-it-makes': 'during = 3;',
 'the-maker-freezes-what-it-makes': 'during = 4;',
}

count = 0
for maker, (text, holder, nearest) in makers.items():
    for use, reader in uses.items():
        for deed, done in deeds.items():
            name = f'{maker}.{use}.{deed}'
            done = done.replace('HOLDER', holder).replace('NEAREST', nearest)
            text_of_maker = text.replace('function make(n: number): any { return ', 'let during = 0;\nfunction make(n: number): any { const made: any = ').replace('(n); }', '(n); if (during === 1) Object.defineProperty(made, "f", { value: 100, writable: true, configurable: true }); if (during === 2) Object.defineProperty(made, "f", { get() { return 100; }, set(v) { (this as any).c = -v; }, configurable: true }); if (during === 3) Object.setPrototypeOf(made, { get f() { return 100; }, set f(v: number) { (this as any).c = -v; } }); if (during === 4) Object.freeze(made); return made; }')
            program = f'''{text_of_maker}
{reader}
const first = make(1), second = make(2);
(globalThis as any).kept = first; (globalThis as any).other = second;
function tell(o: any): string {{ try {{ return use(o); }} catch (error) {{ return (error as Error).name; }} }}
console.log(tell(first), tell(second));
{done}
console.log(tell(first), tell(second));
console.log(tell(make(3)));
'''
            open(os.path.join(out, name + '.ts'), 'w').write(program)
            count += 1
print(count, 'programs')
