#!/usr/bin/env python3
# generate-stores-that-a-property-must-refuse.py <folder>: all 3,220; ../parallel/stores-that-a-property-must-refuse/ holds 8 of them: the same site stores into an object that takes the store, and then into one OF THE SAME CLASS, or of a class with an equal row, whose property refuses it: read-only, frozen, an accessor without a setter,
# an accessor with one, deleted on an object that takes no more names. The value fits the written type. Each program prints what plain Bun prints.
import os, sys, importlib.util
folder = sys.argv[1]
os.makedirs(folder, exist_ok=True)
spec = importlib.util.spec_from_file_location("smugglers", os.path.join(os.path.dirname(os.path.abspath(__file__)), "generate-values-smuggled-into-typed-slots.py"))
sys.argv = [sys.argv[0], os.path.join(folder, ".none")]
smugglers = importlib.util.module_from_spec(spec); spec.loader.exec_module(smugglers)
import shutil; shutil.rmtree(os.path.join(folder, ".none"))
states = {
    "read-only": 'Object.defineProperty(b, "x", { writable: false });',
    "read-only-from-the-constructor": None,
    "frozen": "Object.freeze(b);",
    "sealed": "Object.seal(b);",
    "an-accessor-without-a-setter": 'Object.defineProperty(b, "x", { get() { return START; }, configurable: true });',
    "an-accessor-with-a-setter": 'Object.defineProperty(b, "x", { get() { return START; }, set(w) { seen.push(typeof w); }, configurable: true });',
    "deleted-and-closed": "delete b.x; Object.preventExtensions(b);",
    "read-only-above": 'delete b.x; Object.setPrototypeOf(b, Object.create(B.prototype, { x: { value: START, writable: false } }));',
}
kinds = {"a-text": ("string", '"start"', '"stored" + i', "b.x.length + b.x"), "an-object": ("Bar", "new Bar()", "new Bar(i)", 'b.x.q + ":" + b.x.r')}
count = 0
for kind, (written, start, value, use) in kinds.items():
    for state, change in states.items():
        for road, (front, body) in smugglers.roads.items():
            for other in ("the-same-class", "a-class-with-an-equal-row"):
                text = "// the road: %s . the property: %s . %s . it holds %s\n" % (road.replace("-", " "), state.replace("-", " "), other.replace("-", " "), kind.replace("-", " "))
                text += 'class Bar { q: string = "bar-q"; r: number; constructor(r: number = 2) { this.r = r; } }\n'
                fixed = 'constructor() { Object.defineProperty(this, "x", { value: %s }); }' % start
                if state == "read-only-from-the-constructor":
                    # one name each, so that the two rows are equal
                    text += "class A { x: %s = %s; }\n" % (written, start)
                    text += "class B { declare x: %s; %s }\n" % (written, fixed)
                else:
                    text += "class A { x: %s = %s; y: number = 1; }\n" % (written, start)
                    text += "class B { x: %s = %s; y: number = 2; }\n" % (written, start)
                text += 'const unseen = (0, eval)("(x) => x");\nconst seen: string[] = [];\n' + (front + "\n" if front else "")
                text += "function store(o: any, v: any): void { %s }\n" % body
                text += "function read(b: B): string { try { return String(%s); } catch (error) { return (error as Error).constructor.name; } }\n" % use
                text += "const said = new Map<string, number>();\nfor (let i = 0; i < 300; i++) {\n"
                text += "  const a = unseen(new %s()), b = unseen(new B()), v = unseen(%s);\n" % ("B" if other == "the-same-class" and state != "read-only-from-the-constructor" else "A", value)
                if change:
                    text += "  " + change.replace("START", start) + "\n"
                text += '  let thrown = "-";\n  try { store(a, v); store(b, v); } catch (error) { thrown = (error as Error).constructor.name; }\n'
                text += "  const line = (read(b) + \" \" + thrown + \" \" + seen.length).replace(/[0-9]+/g, \"#\");\n  said.set(line, (said.get(line) ?? 0) + 1);\n}\n"
                text += 'console.log([...said].map(([line, times]) => line + " x" + times).join(" | "));\n'
                open(os.path.join(folder, "-".join((road, "where-it-is", state, "on", other, "holding", kind)) + ".ts"), "w").write(text)
                count += 1
print(count, "programs")
