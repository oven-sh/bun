#!/usr/bin/env python3
"""Writes test/aot/parallel/calls-through-the-method-table-while-classes-are-defined/.

`measure(s: Shape)` calls `s.area(1)` on one of several classes: compiled code goes through a table of methods by the shape of the receiver, tests no guard and asks no object.
A word of the table holds the compiled method while the class is as it is written, and a lookup once it is not. The word holds the compiled method from the start of the process:
that is right only if no object of a class is measured before the run time has looked at what the definition of the class has made.
Each program writes the class Late in one way and does one deed in the middle of its definition, right behind it, or at a second evaluation. What is printed is primitive. The reference is `bun <file>`.

    python3 test/aot/tools/generate-calls-through-the-method-table-while-classes-are-defined.py test/aot/parallel/calls-through-the-method-table-while-classes-are-defined
"""
import os
import sys

HEAD = '''// Made by test/aot/tools/generate-calls-through-the-method-table-while-classes-are-defined.py.
const said: string[] = [];
const unseen = (0, eval);
const one: number = +process.argv[2] || 1;
class Shape {
  edge = 2;
  area(k: number): number { return this.edge * k; }
  around(k: number): number { return this.edge * 4 + this.area(k); }
}
class Disk extends Shape {
  area(k: number): number { return this.edge * k * 3; }
}
class Other {
  edge = 5;
  area(k: number): number { return 1000 + k; }
  around(k: number): number { return 2000 + k; }
}
function measure(s: Shape): number { return s.area(1) + s.around(1); }
function attempt(work: () => unknown): void {
  try {
    said.push(String(work()));
  } catch (error: any) {
    said.push("thrown: " + error.name);
  }
}
attempt(() => measure(new Shape()) + " " + measure(new Disk()));
'''

# What makes the guards of Late begin at its evaluation, or not. MEMBER stands among the members of Late.
KINDS = {
    "every-member-is-written": "",
    "a-static-member-under-a-computed-key": "  static [Symbol.for(\"tag\")]() { return 1; }\n",
    "a-member-under-a-computed-key": "  [Symbol.for(\"tag\")]() { return 1; }\n",
    "a-member-under-a-computed-text": "  [\"ta\" + \"g\"]() { return 1; }\n",
}
PARENT = "Shape"
BODY = "  late = 4;\nMEMBER  area(k: number): number { return this.edge * k * 5; }\nINSIDE"


def late(member, inside="", parent=PARENT, name="Late"):
    return "class " + name + " extends " + parent + " {\n" + BODY.replace("MEMBER", member).replace("INSIDE", inside) + "}\n"


def programs(member):
    measured = "attempt(() => measure(new Late()));\n"
    yield "nothing-is-done", late(member) + measured
    yield "a-static-block-measures-an-object", late(member, "  static { attempt(() => measure(new Late())); }\n") + measured
    yield "a-static-field-measures-an-object", late(member, "  static first = measure(new Late());\n") + "said.push(String(Late.first));\n" + measured
    yield "a-computed-key-measures-the-other-classes", late(member + "  [(attempt(() => measure(new Disk())), \"extra\")]() { return 2; }\n") + measured
    yield "a-computed-key-asks-for-the-class", late(member + "  [(attempt(() => measure(new (Late as any)())), \"extra\")]() { return 2; }\n") + measured
    yield "a-computed-key-lands-on-the-method", late(member, "  [\"ar\" + \"ea\"](k: number): number { return 70 + k; }\n") + measured
    yield "another-parent-is-handed-at-the-definition", "const parents: any[] = [Shape, Other];\n" + late(member, parent="(parents[one] as typeof Shape)") + measured
    yield "the-written-parent-is-handed-through-a-list", "const parents: any[] = [Other, Shape];\n" + late(member, parent="(parents[one] as typeof Shape)") + measured
    yield "the-class-is-evaluated-twice", "function make() {\n  " + late(member).replace("\n", "\n  ").rstrip() + "\n  return Late;\n}\nconst First = make(), Second = make();\nattempt(() => measure(new First()) + \" \" + measure(new Second()));\n(Second.prototype as any).area = function () { return 7; };\nattempt(() => measure(new First()) + \" \" + measure(new Second()));\n"
    yield "the-class-is-evaluated-late", "let Kept: any;\nsetTimeout(() => {\n  " + late(member).replace("\n", "\n  ").rstrip() + "\n  Kept = Late;\n  attempt(() => measure(new Late()));\n  console.log(said.join(\"\\n\"));\n}, 1);\n"
    yield "the-method-is-replaced-right-behind-the-definition", late(member) + "(Late.prototype as any).area = function () { return 7; };\n" + measured
    yield "unseen-code-replaces-the-method-right-behind-the-definition", late(member) + "unseen(\"(C) => { C.prototype.area = function () { return 7; }; }\")(Late);\n" + measured
    yield "a-static-block-replaces-the-method", late(member, "  static { (Late.prototype as any).area = function () { return 7; }; attempt(() => measure(new Late())); }\n") + measured
    yield "unseen-code-replaces-the-method-in-a-static-block", late(member, "  static { unseen(\"(C) => { C.prototype.area = function () { return 7; }; }\")(Late); attempt(() => measure(new Late())); }\n") + measured
    yield "a-static-block-deletes-the-method", late(member, "  static { delete (Late.prototype as any).area; attempt(() => measure(new Late())); }\n") + measured
    yield "a-static-block-lays-the-prototype-below-another", late(member, "  static { Object.setPrototypeOf(Late.prototype, Other.prototype); attempt(() => measure(new Late())); }\n") + measured
    yield "a-static-block-replaces-the-method-of-the-parent", late(member, "  static { (Shape.prototype as any).around = function () { return 9; }; attempt(() => measure(new Late())); }\n") + measured + "attempt(() => measure(new Disk()));\n"
    yield "the-method-of-the-parent-is-replaced-in-front-of-the-definition", "(Shape.prototype as any).around = function () { return 9; };\n" + late(member) + measured + "attempt(() => measure(new Disk()));\n"
    yield "a-class-below-is-defined-in-a-static-block", late(member, "  static {\n    class Below extends Late { area(k: number): number { return 11 * k; } }\n    attempt(() => measure(new Below()) + \" \" + measure(new Late()));\n  }\n") + measured
    yield "the-definition-throws-and-is-tried-again", "let tries = 0;\nfunction key(): string { if (!tries++) throw new RangeError(\"not yet\"); return \"extra\"; }\nfunction make() {\n  " + late(member + "  [key()]() { return 2; }\n").replace("\n", "\n  ").rstrip() + "\n  return Late;\n}\nattempt(() => measure(new (make())()));\nattempt(() => measure(new (make())()));\n"
    yield "the-constructor-lays-a-method-of-its-own-on-the-object", late(member, "  constructor() { super(); if (one) (this as any).area = () => 8; }\n") + measured
    yield "an-object-is-laid-below-another-prototype", late(member) + "const moved = new Late();\nObject.setPrototypeOf(moved, Other.prototype);\nattempt(() => measure(moved) + \" \" + measure(new Late()));\n"


# A class whose constructor makes the objects of a tagged union: the objects are of the layout of the member that the tag picks, and nobody ever defines a class of that layout.
TAGGED = '''// Made by test/aot/tools/generate-calls-through-the-method-table-while-classes-are-defined.py.
const said: string[] = [];
const unseen = (0, eval);
interface Base { kind: number; pos: number; who(): string; more(): string }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
class NodeObject {
  declare kind: number;
  declare pos: number;
  constructor(kind: number, pos: number) { this.kind = kind; this.pos = pos; }
  who(): string { return "node " + this.kind; }
  more(): string { return "more " + this.pos; }
}
class TokenObject extends NodeObject {
  who(): string { return "token " + this.kind; }
}
function num(value: number): Num { const made = new NodeObject(1, 0) as unknown as Num; made.value = value; return made; }
function str(text: string): Str { const made = new NodeObject(2, 0) as unknown as Str; made.text = text; return made; }
function tell(n: Base): string { return n.who() + " " + n.more(); }
function tellAll(): void {
  try {
    said.push(tell(num(1)) + " | " + tell(str("s")) + " | " + tell(new TokenObject(3, 1) as Base) + " | " + tell(kept));
  } catch (error: any) {
    said.push("thrown: " + error.name);
  }
}
const kept: Base = num(5);
tellAll();
DEED
tellAll();
console.log(said.join("\\n"));
export {};
'''
DEEDS_ON_TAGGED = {
    "nothing-is-done": "",
    "the-method-is-replaced": "(NodeObject.prototype as any).who = function () { return \"replaced\"; };",
    "unseen-code-replaces-the-method": "unseen(\"(C) => { C.prototype.who = function () { return 'replaced, unseen'; }; }\")(NodeObject);",
    "the-method-is-deleted": "delete (NodeObject.prototype as any).more;",
    "an-object-gets-a-method-of-its-own": "(kept as any).who = () => \"its own\";",
    "unseen-code-gives-an-object-a-method-of-its-own": "unseen(\"(o) => { o.who = () => 'its own, unseen'; }\")(kept);",
    "an-object-is-laid-below-another-prototype": "Object.setPrototypeOf(kept, { who() { return \"moved\"; }, more() { return \"moved too\"; } });",
    "unseen-code-lays-an-object-below-another-prototype": "unseen(\"(o) => { Object.setPrototypeOf(o, { who() { return 'moved, unseen'; }, more() { return 'moved too'; } }); }\")(kept);",
    "the-prototype-object-is-laid-below-another": "Object.setPrototypeOf(NodeObject.prototype, { extra() { return 1; } });",
    "the-method-of-the-class-below-is-replaced": "(TokenObject.prototype as any).who = function () { return \"token replaced\"; };",
    "an-accessor-is-laid-in-the-place-of-the-method": "Object.defineProperty(NodeObject.prototype, \"who\", { get() { return () => \"by a getter\"; }, configurable: true });",
}
# Below a constructor function, with a member that no record can make in the middle: the members behind it are laid by the definition.
BELOW_A_FUNCTION = '''// Made by test/aot/tools/generate-calls-through-the-method-table-while-classes-are-defined.py.
const unseen = (0, eval);
function Base() {}
class L extends Base { a() { return 1; } 0() { return 0; } c() { return 3; } }
class M extends L { a() { return 10; } }
function measure(o) { return o.a() + o.c(); }
const l = new L(), m = new M();
console.log(measure(l), measure(m));
DEED
console.log(measure(l), measure(m), measure(new L()), measure(new M()));
'''
DEEDS_BELOW_A_FUNCTION = {
    "nothing-is-done": "",
    "the-first-method-is-replaced": "L.prototype.a = () => 2;",
    "the-last-method-is-replaced": "L.prototype.c = () => 4;",
    "unseen-code-replaces-the-first-method": "unseen(\"(C) => { C.prototype.a = () => 2; }\")(L);",
    "unseen-code-replaces-the-last-method": "unseen(\"(C) => { C.prototype.c = () => 4; }\")(L);",
    "a-method-is-laid-on-the-function-above": "Base.prototype.c = () => 5; delete L.prototype.c;",
}


def main():
    folder = sys.argv[1]
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        if old.endswith(".ts") or old.endswith(".js"):
            os.remove(os.path.join(folder, old))
    count = 0
    for kind_name, member in KINDS.items():
        for deed_name, text in programs(member):
            whole = HEAD + text
            if "console.log(said" not in text:
                whole += "console.log(said.join(\"\\n\"));\n"
            whole += "export {};\n"
            with open(os.path.join(folder, deed_name + "-where-" + kind_name + ".ts"), "w") as out:
                out.write(whole)
            count += 1
    for deed_name, deed in DEEDS_ON_TAGGED.items():
        with open(os.path.join(folder, deed_name + "-where-the-class-is-a-tagged-maker.ts"), "w") as out:
            out.write(TAGGED.replace("DEED", deed))
        count += 1
    for deed_name, deed in DEEDS_BELOW_A_FUNCTION.items():
        with open(os.path.join(folder, deed_name + "-where-the-class-stands-below-a-function.js"), "w") as out:
            out.write(BELOW_A_FUNCTION.replace("DEED", deed))
        count += 1
    print(count, "programs")


main()
