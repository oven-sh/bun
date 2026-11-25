#!/usr/bin/env python3
# all 40; ../parallel/pushes-that-run-code/ holds 3 of them.
"""Writes test/aot/parallel/pushes-that-run-code/: `list.push(x)` on a parameter whose callers are all in sight, where the push runs code of the program.

Whoever takes the list for one that is as its class makes it takes the push for an operation that runs no code, and keeps what it has read in front of it. In each program somebody has laid something
on the list or above it, in one way, and what is laid there changes one thing that the function has read in front of the push and reads again behind it. What is printed is primitive.

    python3 test/aot/tools/generate-pushes-that-run-code.py test/aot/parallel/pushes-that-run-code
"""
import os
import sys

DEEDS = {
    "a-setter-above-the-end": "const above = Object.create(Array.prototype);\n  for (let at = 4; at < 24; at++) Object.defineProperty(above, at, { set(x) { CHANGE } });\n  Object.setPrototypeOf(list, above);",
    "a-proxy-above": "Object.setPrototypeOf(list, new Proxy(Array.prototype, { set(target, key, x, receiver) { CHANGE return Reflect.defineProperty(receiver, key, { value: x, writable: true, enumerable: true, configurable: true }); } }));",
    "a-method-of-its-own": "(list as any).push = function (x: number) { CHANGE return Array.prototype.push.call(this, x); };",
    "a-method-above": "Object.setPrototypeOf(list, { __proto__: Array.prototype, push(x: number) { CHANGE return Array.prototype.push.call(this, x); } });",
    "nothing": "",
}
# name: (what is declared, how the deed changes it, how the function reads it, the parameter, the argument)
OBSERVED = {
    "a-field": ("const holder = { count: 0 };", "holder.count++;", "seen.count", "seen: { count: number }", "holder"),
    "a-variable": ("let count = 0;", "count++;", "count", "seen: number", "0"),
    "an-element-of-another-list": ("const others: number[] = [0, 0];", "others[1]++;", "seen[1]", "seen: number[]", "others"),
    "its-own-first-element": ("", "list[0]++;", "list[0]", "seen: number", "0"),
}
WAYS = {
    "once": "const before = READ;\n  list.push(7);\n  return before + \":\" + READ;",
    "in-a-loop": "let text = \"\";\n  for (let i = 0; i < 3; i++) {\n    const before = READ;\n    list.push(i);\n    text += before + \":\" + READ + \" \";\n  }\n  return text;",
}


def main():
    folder = sys.argv[1]
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        if old.endswith(".ts"):
            os.remove(os.path.join(folder, old))
    count = 0
    for deed_name, deed in DEEDS.items():
        for observed_name, (declared, change, read, parameter, argument) in OBSERVED.items():
            for way_name, way in WAYS.items():
                text = "// Made by test/aot/tools/generate-pushes-that-run-code.py.\n" + (declared + "\n" if declared else "")
                text += "function make(): number[] {\n  const list: number[] = [];\n  for (let i = 0; i < 4; i++) list.push(i + 1);\n" + ("  " + deed.replace("CHANGE", change) + "\n" if deed else "") + "  return list;\n}\n"
                text += f"function put(list: number[], {parameter}): string {{\n  " + way.replace("READ", read) + "\n}\n"
                text += f"const list = make();\nfor (let turn = 0; turn < 3; turn++) console.log(put(list, {argument}), list.length);\n"
                with open(os.path.join(folder, f"{deed_name}-changes-{observed_name}-{way_name}.ts"), "w") as out:
                    out.write(text)
                count += 1
    print(count, "programs")


main()
