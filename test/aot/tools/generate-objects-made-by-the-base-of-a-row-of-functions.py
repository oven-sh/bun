#!/usr/bin/env python3
"""Writes test/aot/parallel/objects-made-by-the-base-of-a-row-of-functions/: a constructor function with something linked below it, an object made by `new Base(..)`, and one thing done with that object.

The compiler takes what `new Base(..)` makes for an object of Base's own layout, though `this` in the body of Base may be an object of whatever stands below.
Each program links the row in one way, makes the object in one way, may change it or what stands above it in one way (by code that the compiler sees, or by code out of eval, which it does not), and uses it in one way.
What is printed is primitive. The reference is `bun <file>`.

    python3 test/aot/tools/generate-objects-made-by-the-base-of-a-row-of-functions.py test/aot/parallel/objects-made-by-the-base-of-a-row-of-functions
"""
import os
import sys

HEAD = '''// Made by test/aot/tools/generate-objects-made-by-the-base-of-a-row-of-functions.py.
function show(x) {
  return typeof x === "function" ? "function" : typeof x === "object" && x !== null ? "object" : String(x);
}
function attempt(work) {
  try {
    return show(work());
  } catch (error) {
    return "thrown: " + error.name;
  }
}
function Base(a) {
  this.a = a;
BODY}
Base.prototype.first = function () { return "first of Base " + this.a; };
Base.prototype.second = function () { return "second of Base " + this.a; };
'''

# What stands below Base.
LINKS = {
    "object-create": "function Below(a, b) { Base.call(this, a); this.b = b; }\nBelow.prototype = Object.create(Base.prototype);\nBelow.prototype.second = function () { return \"second of Below \" + this.b; };\nBelow.prototype.third = function () { return \"third of Below \" + this.b; };\n",
    "set-prototype-of": "function Below(a, b) { this.a = a; this.b = b; }\nObject.setPrototypeOf(Below.prototype, Base.prototype);\nBelow.prototype.second = function () { return \"second of Below \" + this.b; };\nBelow.prototype.third = function () { return \"third of Below \" + this.b; };\n",
    "a-class": "class Below extends Base {\n  constructor(a, b) { super(a); this.b = b; }\n  second() { return \"second of Below \" + this.b; }\n  third() { return \"third of Below \" + this.b; }\n}\n",
}
# The rest of the body of Base.
BODIES = {
    "": "",
    "that-calls-a-method-on-this": "  this.said = this.second();\n",
    "that-returns-another-object": "  if (a === 7) return { a: \"other\", first() { return \"first of the other\"; }, second() { return \"second of the other\"; } };\n",
    "that-keeps-this": "  kept.push(this);\n",
}
# `made` is the object.
MAKERS = {
    "new": "new Base(i)",
    "reflect-construct": "Reflect.construct(Base, [i])",
    "reflect-construct-for-what-stands-below": "Reflect.construct(Base, [i], Below)",
    "new-of-a-bound-function": "new (Base.bind(null, i))()",
}
# In the turn 2, in front of the use. `unseen` is made of text at run time.
CHANGES = {
    "": "",
    "an-own-method-is-laid-on-it": "if (i === 2) made.first = function () { return \"its own first\"; };",
    "unseen-code-lays-an-own-method-on-it": "if (i === 2) unseen(\"(o) => { o.first = function () { return 'its own first, unseen'; }; }\")(made);",
    "its-prototype-is-changed": "if (i === 2) Object.setPrototypeOf(made, { first() { return \"first of a new prototype\"; }, second() { return \"second of a new prototype\"; } });",
    "unseen-code-changes-its-prototype": "if (i === 2) unseen(\"(o) => { Object.setPrototypeOf(o, { first() { return 'first, unseen'; }, second() { return 'second, unseen'; } }); }\")(made);",
    "the-method-of-the-base-is-replaced": "if (i === 2) Base.prototype.first = function () { return \"another first \" + this.a; };",
    "unseen-code-replaces-the-method-of-the-base": "if (i === 2) unseen(\"(o) => { Object.getPrototypeOf(o).first = function () { return 'another first, unseen ' + this.a; }; }\")(made);",
    "the-prototype-of-the-function-is-replaced": "if (i === 1) Base.prototype = { first() { return \"first of the new Base.prototype\"; }, second() { return \"second of the new Base.prototype\"; } };",
}
USES = {
    "a-method-of-the-base-is-called": "made.first()",
    "a-method-that-is-laid-anew-below-is-called": "made.second()",
    "a-method-of-what-stands-below-is-called": "made.third()",
    "a-field-is-read": "made.a",
    "a-field-of-what-stands-below-is-read": "made.b",
    "it-is-asked-for-its-class": "(made instanceof Base) + \" \" + (made instanceof Below) + \" \" + (made.constructor === Base)",
}


def main():
    folder = sys.argv[1]
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        if old.endswith(".js"):
            os.remove(os.path.join(folder, old))
    count = 0
    for link_name, link in LINKS.items():
        for body_name, body in BODIES.items():
            for maker_name, maker in MAKERS.items():
                for change_name, change in CHANGES.items():
                    for use_name, use in USES.items():
                        # One thing is varied beside the link and the use: a body, a maker or a change.
                        if sum(1 for chosen in (body_name, change_name) if chosen) + (maker_name != "new") > 1:
                            continue
                        text = "const kept = [];\nconst unseen = (0, eval);\n" + HEAD.replace("BODY", body) + link
                        text += "function run(n) {\n  let said = \"\";\n  for (let i = 0; i < n; i++) {\n    const below = new Below(i, i + 10);\n    const made = " + maker + ";\n"
                        if change:
                            text += "    " + change + "\n"
                        text += "    said += attempt(() => " + use + ") + \" | \" + attempt(() => below.second()) + \"\\n\";\n  }\n  return said;\n}\n"
                        text += "console.log(run(4) + attempt(() => new Base(7).first()) + \" \" + kept.length);\n"
                        parts = [use_name, "on-what", maker_name, "makes"]
                        if body_name:
                            parts += ["in-a-body", body_name]
                        if change_name:
                            parts += ["after", change_name]
                        parts += ["above", link_name]
                        with open(os.path.join(folder, "-".join(parts) + ".js"), "w") as out:
                            out.write(text)
                        count += 1
    print(count, "programs")


main()
