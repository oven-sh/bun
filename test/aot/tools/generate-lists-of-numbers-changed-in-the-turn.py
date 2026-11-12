#!/usr/bin/env python3
"""Writes test/aot/parallel/lists-of-numbers-changed-in-the-turn/: a loop over a list declared `number[]`, and in one turn of it something changes the list, in one way, at one place of the turn.

Compiled code knows things of the list for a while: that a position lies below the length (behind `i < list.length`), the kind of the storage, that an element is there, what was read.
Each of these ends where the list may be written. In each program the change stands between the place where such a thing is learned and the place where it is used:
in front of the read, between the read and the store, in the value that is stored, by a function, by a callback that nobody knows, by `valueOf`, through a second name of the list.
What is printed is primitive. The reference is `bun <file>`.

    python3 test/aot/tools/generate-lists-of-numbers-changed-in-the-turn.py test/aot/parallel/lists-of-numbers-changed-in-the-turn
"""
import os
import sys

HEAD = '''// Made by test/aot/tools/generate-lists-of-numbers-changed-in-the-turn.py.
const one: number = +process.argv[2] || 1;
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : String(x);
}
function describe(list: any): string {
  let text = list.length + " [";
  for (const key of Object.keys(list).slice(0, 12)) text += " " + key + "=" + show(list[key]);
  return text + " ]";
}
'''

MAKERS = {
    "whole-numbers": "for (let i = 0; i < 6; i++) list.push(i + 1);",
    "fractions": "for (let i = 0; i < 6; i++) list.push(i + one / 2);",
}
# What is done to `it` (the list under a name of type any) in the turn `at`.
CHANGES = {
    "the-length-is-cut": "it.length = 2;",
    "the-length-is-cut-to-nothing": "it.length = 0;",
    "the-element-is-deleted": "delete it[at];",
    "a-text-is-stored": "it[at] = \"text\";",
    "a-fraction-is-stored": "it[at] = 0.25;",
    "an-object-is-stored": "it[at] = { valueOf() { return 40; } };",
    "the-last-is-popped": "it.pop();",
    "the-first-is-shifted-out": "it.shift();",
    "it-is-frozen": "Object.freeze(it);",
    "an-element-far-out-is-stored": "it[70000] = 1;",
    "an-accessor-is-laid": "Object.defineProperty(it, at, { get() { return 70; }, set(x) {}, enumerable: true, configurable: true });",
    "it-grows": "it.push(9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9);",
}
# name: (declarations in front of work(), the turn; CHANGE is a statement, CALL an expression that makes the change and gives 0)
TURNS = {
    "in-front-of-the-read-by-a-function": ("function change(it: any, at: number): number {\n  if (at === 2) { CHANGE }\n  return 0;\n}\n",
        "change(list, i);\n    list[i] = list[i] * 2;"),
    "between-the-read-and-the-store-by-a-function": ("function change(it: any, at: number): number {\n  if (at === 2) { CHANGE }\n  return 0;\n}\n",
        "list[i] = list[i] * 2 + change(list, i);"),
    "in-front-of-the-read-by-a-callback": ("const callbacks: ((it: any, at: number) => number)[] = [(it, at) => 0, (it, at) => {\n  if (at === 2) { CHANGE }\n  return 0;\n}];\n",
        "callbacks[i & 1 ? 0 : 1](list, i);\n    list[i] = list[i] * 2;"),
    "by-the-value-of-what-is-added": ("let turn = 0;\nlet held: any;\nconst added: any = { valueOf() {\n  const it = held, at = turn;\n  if (at === 2) { CHANGE }\n  return 0;\n} };\n",
        "turn = i;\n    held = list;\n    list[i] = list[i] * 2 + added;"),
    "through-a-second-name": ("",
        "if (i === 2) {\n      const it: any = second, at = i;\n      CHANGE\n    }\n    list[i] = list[i] * 2;"),
    "in-front-of-a-sum": ("function change(it: any, at: number): number {\n  if (at === 2) { CHANGE }\n  return 0;\n}\n",
        "change(list, i);\n    sum += list[i];"),
    "in-front-of-a-store-of-the-counter": ("function change(it: any, at: number): number {\n  if (at === 2) { CHANGE }\n  return 0;\n}\n",
        "change(list, i);\n    list[i] = i;"),
    "in-front-of-a-push": ("function change(it: any, at: number): number {\n  if (at === 2) { CHANGE }\n  return 0;\n}\n",
        "change(list, i);\n    if (i < 4) list.push(i + one / 4);"),
}


def main():
    folder = sys.argv[1]
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        if old.endswith(".ts"):
            os.remove(os.path.join(folder, old))
    count = 0
    for maker_name, maker in MAKERS.items():
        for change_name, change in CHANGES.items():
            for turn_name, (declared, turn) in TURNS.items():
                for leaves in (False, True):
                    text = HEAD + declared.replace("CHANGE", change)
                    text += "function make(): number[] {\n  const list: number[] = [];\n  " + maker + "\n" + ("  (globalThis as any).keptOutside = list;\n" if leaves else "") + "  return list;\n}\n"
                    text += "function work(list: number[], second: number[]): number {\n  let sum = 0;\n  for (let i = 0; i < list.length && i < 9; i++) {\n    " + turn.replace("CHANGE", change) + "\n  }\n  return sum;\n}\n"
                    text += "for (let round = 0; round < 2; round++) {\n  const list = make();\n  try {\n    console.log(show(work(list, list)));\n  } catch (error: any) {\n    console.log(\"thrown: \" + error.name);\n  }\n  console.log(describe(list));\n}\n"
                    name = f"{change_name}-{turn_name}-of-{maker_name}" + ("-that-have-left" if leaves else "")
                    with open(os.path.join(folder, name + ".ts"), "w") as out:
                        out.write(text)
                    count += 1
    print(count, "programs")


main()
