#!/usr/bin/env python3
# generate-values-smuggled-into-typed-slots.py <folder>: all 2,548; ../parallel/values-smuggled-into-typed-slots/ holds 8 of them: one-shape programs that try to get a value into a slot that is held to another type, and then read the slot typed.
# class A { x: <the type of the value> } and class B { x: <another type> } have equal rows: the same names, order and offsets. ONE SITE stores into an A, where the value fits, and then into a B, 300 turns: whatever the site, the shape, the row or
# the address has remembered of the first is there for the second. Then compiled code that knows `b: B` reads b.x and uses it as what is written. Each program prints what plain Bun prints.
import os, sys
folder = sys.argv[1]
os.makedirs(folder, exist_ok=True)

# what is smuggled: name: (its written type, the value, what an A starts with)
values = {
    "an-object-of-another-class": ("Foo", "new Foo()", "new Foo()"),
    "a-text": ("string", '"s" + i', '"a"'),
    "an-integer": ("number", "7", "1"),
    "a-fraction": ("number", "0.5", "1.5"),
    "an-integer-past-int32": ("number", "2 ** 40 + i", "2 ** 40"),
    "minus-zero": ("number", "-0", "-0"),
    "a-symbol": ("symbol", "Symbol.iterator", "Symbol.iterator"),
    "a-big-integer": ("bigint", "5n", "1n"),
    "a-function": ("() => string", '() => "called"', '() => "a"'),
    "a-list": ("number[]", "[1, 2, 3]", "[]"),
    "null": ("Foo | null", "null", "null"),
    "undefined": ("Foo | undefined", "undefined", "undefined"),
    "a-boolean": ("boolean", "true", "false"),
}
# what the slot is held to: name: (the written type, what a B starts with, the typed use, the kinds of value that fit it)
slots = {
    "an-object": ("Bar", "new Bar()", 'b.x.q + ":" + b.x.r', []),
    "an-object-or-undefined": ("Bar | undefined", "new Bar()", 'b.x ? b.x.q + ":" + b.x.r : "none"', ["undefined"]),
    "a-text": ("string", '"b"', 'b.x.length + ":" + b.x.charCodeAt(0)', ["a-text"]),
    "an-integer": ("number", "3", "String((b.x | 0) + (b.x + 1))", ["an-integer", "a-fraction", "an-integer-past-int32", "minus-zero"]),
    "a-fraction": ("number", "1.5", "String(b.x * 2)", ["an-integer", "a-fraction", "an-integer-past-int32", "minus-zero"]),
    "a-boolean": ("boolean", "false", '(b.x ? "yes" : "no") + (b.x === true)', ["a-boolean"]),
    "a-function": ("() => string", '() => "b"', "b.x()", ["a-function"]),
    "a-list": ("number[]", "[9]", 'b.x.length + ":" + b.x[0]', ["a-list"]),
}
descriptor = "{ value: v, writable: true, enumerable: true, configurable: true }"
# the road: name: (lines in front, the body of store(o, v))
roads = {
    "by-name": ("", "o.x = v;"),
    "by-a-key": ('const key = unseen("x");', "o[key] = v;"),
    "object-assign": ("", "Object.assign(o, { x: v });"),
    "object-assign-from-what-nobody-has-seen": ("", "Object.assign(o, unseen({ x: v }));"),
    "object-assign-of-two-names": ("", "Object.assign(o, { y: 5, x: v });"),
    "define-property": ("", 'Object.defineProperty(o, "x", %s);' % descriptor),
    "define-properties": ("", "Object.defineProperties(o, { x: %s });" % descriptor),
    "reflect-set": ("", 'Reflect.set(o, "x", v);'),
    "reflect-define-property": ("", 'Reflect.defineProperty(o, "x", %s);' % descriptor),
    "through-a-proxy": ("", "new Proxy(o, {}).x = v;"),
    "an-object-pattern": ("", "({ x: o.x } = { x: v });"),
    "a-list-pattern": ("", "[o.x] = [v];"),
    "evaluated-text-by-name": ('const poke = (0, eval)("(o, v) => { o.x = v; }");', "poke(o, v);"),
    "evaluated-text-by-a-key": ('const poke = (0, eval)("(o, k, v) => { o[k] = v; }");', 'poke(o, "x", v);'),
    "deleted-and-stored-again": ("", "delete o.x; o.x = v;"),
    "deleted-and-defined-again": ("", 'delete o.x; Object.defineProperty(o, "x", %s);' % descriptor),
    "for-in-off-a-copy": ("", "const from: any = { x: v }; for (const k in from) o[k] = from[k];"),
    "entries-of-a-copy": ("", "for (const [k, w] of Object.entries({ x: v })) o[k] = w;"),
    "a-logical-assignment": ("", "o.x &&= v; o.x ||= v; o.x ??= v;"),
    "by-a-receiver-below": ("", 'Reflect.set(Object.getPrototypeOf(Object.create(o)), "x", v, o);'),
    "behind-an-accessor-that-is-taken-away": ("", 'Object.defineProperty(o, "x", { get() { return 1; }, configurable: true }); Object.defineProperty(o, "x", %s);' % descriptor),
}
head = '''// the road: %s . the slot is held to: %s . what is smuggled: %s
class Foo { p: string = "foo-p"; n: number = 1; }
class Bar { q: string = "bar-q"; r: number = 2; }
'''
tail = '''function read(b: B): string { try { return String(%s); } catch (error) { return (error as Error).constructor.name; } }
const peek = (0, eval)("(o) => typeof o.x + '/' + Object.keys(o).join()");
const said = new Map<string, number>();
for (let i = 0; i < 300; i++) {
%s
  const line = read(b) + " " + peek(b);
  said.set(line, (said.get(line) ?? 0) + 1);
}
console.log([...said].map(([line, times]) => line + " x" + times).join(" | "));
'''
count = 0
def write(name, text):
    global count
    open(os.path.join(folder, name + ".ts"), "w").write(text)
    count += 1

for value, (typeOfValue, made, startOfA) in values.items():
    for slot, (typeOfSlot, startOfB, use, fitting) in slots.items():
        if value in fitting:
            continue
        words = (slot, value)
        for road, (front, body) in roads.items():
            text = head % (road.replace("-", " "), slot.replace("-", " "), value.replace("-", " "))
            text += "class A { x: %s = %s; y: number = 1; }\nclass B { x: %s = %s; y: number = 2; }\n" % (typeOfValue, startOfA, typeOfSlot, startOfB)
            text += 'const unseen = (0, eval)("(x) => x");\n' + (front + "\n" if front else "")
            text += "function store(o: any, v: any): void { %s }\n" % body
            turn = "  const a = unseen(new A()), b = unseen(new B()), v = unseen(%s);\n  try { store(a, v); store(b, v); } catch (error) { said.set((error as Error).constructor.name, 1); }" % made
            write("-".join((road, "into", slot, "goes", value)), text + tail % (use, turn))
        # stores that the text types: the constructor, a method, a class below, a private name, the other class copied whole
        typed = {
            "in-the-constructor": ("class A { x: %s; y: number = 1; constructor(v: %s) { this.x = v; } }\nclass B { x: %s; y: number = 2; constructor(v: %s) { this.x = v; } }\n" % (typeOfValue, typeOfValue, typeOfSlot, typeOfSlot),
                "function make(C: any, v: any): any { return new C(v); }\n", "  const v = unseen(%s), a = unseen(make(A, v)), b = unseen(make(B, v));" % made),
            "in-a-method": ("class A { x: %s = %s; y: number = 1; put(v: %s) { this.x = v; } }\nclass B { x: %s = %s; y: number = 2; put(v: %s) { this.x = v; } }\n" % (typeOfValue, startOfA, typeOfValue, typeOfSlot, startOfB, typeOfSlot),
                "function store(o: any, v: any): void { o.put(v); }\n", "  const a = unseen(new A()), b = unseen(new B()), v = unseen(%s);\n  store(a, v); store(b, v);" % made),
            "in-a-function-that-writes-the-types": ("class A { x: %s = %s; y: number = 1; }\nclass B { x: %s = %s; y: number = 2; }\n" % (typeOfValue, startOfA, typeOfSlot, startOfB),
                "function putB(o: B, v: %s): void { o.x = v; }\n" % typeOfSlot, "  const b = unseen(new B()), v = unseen(%s);\n  putB(b, v);" % made),
            "in-a-class-below": ("class A { x: %s = %s; y: number = 1; }\nclass B { x: %s = %s; y: number = 2; }\nclass BelowA extends A { constructor(v: any) { super(); this.x = v; } }\nclass BelowB extends B { constructor(v: any) { super(); this.x = v; } }\n" % (typeOfValue, startOfA, typeOfSlot, startOfB),
                "function make(C: any, v: any): any { return new C(v); }\n", "  const v = unseen(%s), a = unseen(make(BelowA, v)), b = unseen(make(BelowB, v));" % made),
            "the-other-class-assigned-whole": ("class A { x: %s = %s; y: number = 1; }\nclass B { x: %s = %s; y: number = 2; }\n" % (typeOfValue, startOfA, typeOfSlot, startOfB),
                "function copy(to: any, from: any): void { Object.assign(to, from); }\n", "  const a = unseen(new A()), a2 = unseen(new A()), b = unseen(new B());\n  a.x = unseen(%s); copy(a2, a); copy(b, a);" % made),
            "the-other-class-spread-and-assigned": ("class A { x: %s = %s; y: number = 1; }\nclass B { x: %s = %s; y: number = 2; }\n" % (typeOfValue, startOfA, typeOfSlot, startOfB),
                "function copy(to: any, from: any): void { Object.assign(to, { ...from }); }\n", "  const a = unseen(new A()), a2 = unseen(new A()), b = unseen(new B());\n  a.x = unseen(%s); copy(a2, a); copy(b, a);" % made),
            "in-a-field-initializer": ("let next: any;\nclass A { x: %s = next; y: number = 1; }\nclass B { x: %s = next; y: number = 2; }\n" % (typeOfValue, typeOfSlot),
                "", "  next = unseen(%s);\n  const a = unseen(new A()), b = unseen(new B());" % made),
        }
        for road, (classes, front, turn) in typed.items():
            text = head % (road.replace("-", " "), slot.replace("-", " "), value.replace("-", " ")) + classes + 'const unseen = (0, eval)("(x) => x");\n' + front
            write("-".join((road, "into", slot, "goes", value)), text + tail % (use, turn))
print(count, "programs")
