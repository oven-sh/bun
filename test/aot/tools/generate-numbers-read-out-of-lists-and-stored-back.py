#!/usr/bin/env python3
"""Writes test/aot/parallel/numbers-read-out-of-lists-and-stored-back/: one list, one position, one way in which what is read there is used up at once: a program each.

A list declared `number[]` may hold anything, and has the storage that its maker and the values so far have given it. Behind a test of the kind of storage and of the element compiled code reads the number raw.
What the test refuses is read as written: storage for any value, storage that is far apart, a hole (above which something may answer), a position outside the list, an accessor.
The lists are those of generate-numbers-in-lists-of-every-storage.py. Here each leaves the program as soon as it is made, so that nobody can say what it holds.

    python3 test/aot/tools/generate-numbers-read-out-of-lists-and-stored-back.py test/aot/parallel/numbers-read-out-of-lists-and-stored-back
"""
import os
import sys

HEAD = '''// Made by test/aot/tools/generate-numbers-read-out-of-lists-and-stored-back.py.
const one: number = +process.argv[2] || 1;
let told = "";
function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : String(x);
}
function describe(list: any): string {
  let text = list.length + " [";
  for (const key of Object.keys(list)) text += " " + key + "=" + show(list[key]);
  return text + " ]" + (told && " told:" + told);
}
'''

# name: (the lines that make `list`, in front of `return list;`)
LISTS = {
    "whole-numbers": "for (let i = 0; i < 4; i++) list.push(i + 1);",
    "fractions": "for (let i = 0; i < 4; i++) list.push(i + 0.5);",
    "whole-numbers-where-fractions-were": "for (let i = 0; i < 4; i++) list.push(i + 0.5);\n  for (let i = 0; i < 4; i++) list[i] = i + 1;",
    "a-text-among-numbers": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  (list as any)[2] = \"two\";",
    "nothing": "",
    "a-hole-among-whole-numbers": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  delete (list as any)[1];",
    "a-hole-among-fractions": "for (let i = 0; i < 4; i++) list.push(i + 0.5);\n  delete (list as any)[1];",
    "a-hole-beside-a-text": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  (list as any)[2] = \"two\";\n  delete (list as any)[1];",
    "frozen": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  Object.freeze(list);",
    "frozen-fractions": "for (let i = 0; i < 4; i++) list.push(i + 0.5);\n  Object.freeze(list);",
    "sealed": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  Object.seal(list);",
    "closed-to-new-elements": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  delete (list as any)[1];\n  Object.preventExtensions(list);",
    "a-length-that-is-not-writable": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  Object.defineProperty(list, \"length\", { writable: false });",
    "an-accessor-under-an-index": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  Object.defineProperty(list, 1, { get() { return 70; }, set(x) { told += \" \" + show(x); }, enumerable: true, configurable: true });",
    "an-element-that-is-not-writable": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  Object.defineProperty(list, 1, { value: 70, writable: false, enumerable: true, configurable: true });",
    "a-setter-above-a-hole-and-above-the-end": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  delete (list as any)[1];\n  const above = Object.create(Array.prototype);\n  for (const at of [1, 4, 6]) Object.defineProperty(above, at, { set(x) { told += \" \" + at + \":\" + show(x); } });\n  Object.setPrototypeOf(list, above);",
    "a-proxy-above": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  delete (list as any)[1];\n  Object.setPrototypeOf(list, new Proxy(Array.prototype, { set(target, key, x, receiver) { told += \" \" + String(key) + \":\" + show(x); return Reflect.set(target, key, x, receiver); } }));",
    "far-apart": "for (let i = 0; i < 4; i++) list.push(i + 1);\n  list[70000] = 5;",
}
# Those whose maker is not `const list: number[] = [];`
MAKERS = {
    "a-literal-of-whole-numbers": "const list: number[] = [1, 2, 3, 4];",
    "a-literal-of-fractions": "const list: number[] = [0.5, 1.5, 2.5, 3.5];",
    "a-literal-with-a-hole": "const list: number[] = [1, , 3, 4] as number[];",
    "made-with-a-length": "const list: number[] = new Array<number>(4);",
    "made-with-a-length-and-filled": "const list: number[] = new Array<number>(4).fill(1);",
    "made-by-map": "const list: number[] = [1, 2, 3, 4].map(x => x * one);",
    "read-out-of-a-text": "const list: number[] = JSON.parse(\"[1,2,3,4]\");",
    "of-a-class-below-array": "class Below extends Array<number> {}\n  const list: number[] = new Below();\n  for (let i = 0; i < 4; i++) list.push(i + 1);",
}

POSITIONS = {
    "the-first": "0",
    "the-second": "1",
    "the-third": "2",
    "the-end": "list.length",
    "minus-one": "-1",
    "far-out": "60000",
    "the-last-index": "4294967294",
    "past-every-index": "4294967295",
}


def maker(name):
    if name in MAKERS:
        return "function make(): number[] {\n  " + MAKERS[name] + "\n  (globalThis as any).keptOutside = list;\n  return list;\n}\n"
    lines = LISTS[name]
    return "function make(): number[] {\n  const list: number[] = [];\n" + ("  " + lines + "\n" if lines else "") + "  (globalThis as any).keptOutside = list;\n  return list;\n}\n"


TAIL = '''const list = make();
console.log(describe(list));
for (let turn = 0; turn < 3; turn++) {
  try {
    CALL;
  } catch (error: any) {
    console.log("thrown: " + error.name);
  }
  console.log(describe(list));
}
told = "";
console.log(describe(make()));
'''


def program(list_name, put, call):
    return HEAD + maker(list_name) + put + TAIL.replace("CALL", call)


def main():
    folder = sys.argv[1]
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        if old.endswith(".ts"):
            os.remove(os.path.join(folder, old))
    count = 0

    def write(name, text):
        nonlocal count
        with open(os.path.join(folder, name + ".ts"), "w") as out:
            out.write(text)
        count += 1

    for list_name in list(LISTS) + list(MAKERS):
        for position_name, position in POSITIONS.items():
            write(f"half-of-{position_name}-of-{list_name}-stored-at-the-first", program(list_name,
                "function put(list: number[], at: number): void {\n  list[0] = list[at] / 2;\n}\n", f"put(list, {position})"))
            write(f"half-of-{position_name}-of-{list_name}-stored-at-the-first-in-a-loop", program(list_name,
                "function put(list: number[], at: number): void {\n  for (let k = 0; k < 3; k++) list[0] = list[at] / 2 + k;\n}\n", f"put(list, {position})"))
        write(f"each-of-{list_name}-and-the-one-behind-it-added", program(list_name,
            "function put(list: number[]): void {\n  for (let i = 0; i < list.length && i < 9; i++) list[i] = list[i] + list[i + 1];\n}\n", "put(list)"))
        write(f"each-of-{list_name}-read-twice", program(list_name,
            "function put(list: number[]): void {\n  for (let i = 0; i < list.length && i < 9; i++) list[i] = list[i] * list[i];\n}\n", "put(list)"))
    print(count, "programs")


main()
