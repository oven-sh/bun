#!/usr/bin/env python3
"""Writes test/aot/parallel/numbers-in-lists-of-every-storage/: one list, one way to put a number into it or to read one out of it, one number: a program each.

A list declared `number[]` has the storage that its maker and the numbers so far have given it: for int32, for doubles, for any value, or none of the three.
Compiled code chooses its arm by the storage that it finds, and leaves to the run time what the storage refuses: a fraction, -0, NaN or 2^31 in storage for int32, NaN in storage for doubles,
a list that is frozen or full, a hole above which a setter stands. Each program prints what the list holds behind each of three turns, so that the turn behind a change of storage shows too,
and then what the maker makes anew: a literal shares its storage with the lists that were made of it until one of them is written.

    python3 test/aot/tools/generate-numbers-in-lists-of-every-storage.py test/aot/parallel/numbers-in-lists-of-every-storage
"""
import os
import sys

HEAD = '''// Made by test/aot/tools/generate-numbers-in-lists-of-every-storage.py.
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

# name: (the expression, with `from` a number that nobody knows and `i` the counter; what is handed in as `from`)
NUMBERS = {
    "a-whole-sum": ("from + i", "one"),
    "a-fraction": ("from + i * 0.5", "one / 4"),
    "the-counter": ("i", "one"),
    "minus-zero": ("from * 0", "-one"),
    "no-number": ("from - from", "one / 0"),
    "past-int32": ("from + i", "one * 2147483646"),
    "a-count-past-int32": ("i + 2147483646", "one"),
}

POSITIONS = {
    "the-first": "0",
    "the-second": "1",
    "the-end": "list.length",
    "past-the-end": "list.length + 2",
    "minus-one": "-1",
    "the-last-index": "4294967294",
    "past-every-index": "4294967295",
}


def maker(name):
    if name in MAKERS:
        return "function make(): number[] {\n  " + MAKERS[name] + "\n  return list;\n}\n"
    lines = LISTS[name]
    return "function make(): number[] {\n  const list: number[] = [];\n" + ("  " + lines + "\n" if lines else "") + "  return list;\n}\n"


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
        for number_name, (expression, handed) in NUMBERS.items():
            write(f"{number_name}-pushed-in-a-loop-onto-{list_name}", program(list_name,
                f"function put(list: number[], from: number): void {{\n  for (let i = 0; i < 3; i++) list.push({expression});\n}}\n", f"put(list, {handed})"))
            write(f"{number_name}-stored-over-each-of-{list_name}", program(list_name,
                f"function put(list: number[], from: number): void {{\n  for (let i = 0; i < list.length && i < 9; i++) list[i] = {expression};\n}}\n", f"put(list, {handed})"))
            if number_name != "the-counter":
                write(f"{number_name}-pushed-once-onto-{list_name}", program(list_name,
                    f"function put(list: number[], from: number, i: number): number {{\n  return list.push({expression});\n}}\n", f"console.log(put(list, {handed}, turn))"))
        for position_name, position in POSITIONS.items():
            for number_name in ("a-whole-sum", "a-fraction"):
                if number_name == "a-fraction" and position_name not in ("the-first", "the-end"):
                    continue
                expression, handed = NUMBERS[number_name]
                write(f"{number_name}-stored-at-{position_name}-of-{list_name}", program(list_name,
                    f"function put(list: number[], at: number, from: number, i: number): void {{\n  list[at] = {expression};\n}}\n", f"put(list, {position}, {handed}, turn)"))
        write(f"each-of-{list_name}-added-up", program(list_name,
            "function read(list: number[]): number {\n  let sum = 0;\n  for (let i = 0; i < list.length && i < 9; i++) sum += list[i];\n  return sum;\n}\n", "console.log(show(read(list)))"))
        write(f"each-of-{list_name}-doubled-in-place", program(list_name,
            "function put(list: number[]): void {\n  for (let i = 0; i < list.length && i < 9; i++) list[i] = list[i] * 2;\n}\n", "put(list)"))
        for position_name, position in POSITIONS.items():
            if position_name == "past-the-end":
                continue
            write(f"half-of-{position_name}-of-{list_name}", program(list_name,
                "function read(list: number[], at: number): number {\n  return list[at] / 2;\n}\n", f"console.log(show(read(list, {position})))"))
    print(count, "programs")


main()
