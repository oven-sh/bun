#!/usr/bin/env python3
# generate-holes-read-for-arithmetic.py <folder>: one-shape programs: a counted loop reads a list of numbers that has holes, and does one thing with what it reads: arithmetic, which makes NaN of undefined, or something that tells undefined from NaN.
# No turn calls anything or writes a list, so a compiler may test the list once, in front of the loop. Each program holds one list, one place for the hole and one use. What is printed is primitive. The reference is `bun <file>`.
import os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

lists = {
    "of-int32s": "[1, 2, 3, 4, 5, 6]",
    "of-fractions": "[1.5, 2.5, 3.5, 4.5, 5.5, 6.5]",
    "of-both": "[1, 2.5, 3, 4.5, 5, 6.5]",
    "with-a-nan": "[1, NaN, 3.5, 4, 5, 6]",
}
holes = {
    "without-a-hole": "",
    "a-hole-at-the-start": "delete list[0];",
    "a-hole-in-the-middle": "delete list[3];",
    "holes-at-the-end": "list.length = 9;",
    "nothing-but-holes": "list.length = 0; list.length = 4;",
    "undefined-is-stored": "(list as unknown[])[2] = undefined;",
}
uses = {
    "added-to-a-sum": "t += list[i];",
    "a-sum-added-to-it": "t = list[i] + t;",
    "taken-off-a-sum": "t -= list[i];",
    "a-sum-taken-off-it": "t = list[i] - t;",
    "multiplied": "t += 1; u *= list[i];",
    "divided-by": "u = u / list[i];",
    "doubled-then-added": "t += list[i] * 2;",
    "added-to-a-constant": "u = list[i] + 1;",
    "added-to-another-read": "t += list[i] + list[list.length - 1 - i];",
    "added-to-a-text": 'if (list[i] + "" === "undefined") n++;',
    "added-to-what-may-be-a-text": "w = list[i] + w;",
    "held-against-undefined": "if (list[i] === undefined) n++;",
    "held-against-null-loosely": "if (list[i] == null) n++;",
    "asked-for-its-kind": 'if (typeof list[i] === "undefined") n++;',
    "replaced-where-it-is-missing": "t += list[i] ?? 100;",
    "replaced-where-it-is-falsy": "t += list[i] || 100;",
    "kept-in-a-name-and-used-twice": "const x = list[i]; t += x; if (x === undefined) n++;",
    "kept-behind-the-loop": "last = list[i];",
    "held-below-a-number": "if (list[i] < 4) n++;",
    "made-an-int32": "t += list[i] | 0;",
    "negated": "t += -list[i];",
}
head = """// a list LIST, HOLE: what is read is USE
function run(list: number[], w: any) {
  let t = 0, u = 1, n = 0;
  let last: unknown = "none";
  for (let i = 0; i < list.length; i++) { BODY }
  return [t, u, n, String(last), String(w)].join(":");
}
const list: number[] = MAKE;
DEED
const seen: unknown[] = [];
for (let k = 0; k < 3; k++) seen.push(run(list, k === 1 ? "w" : 0));
seen.push(run(MAKE, 0));
console.log(seen.join());
"""
count = 0
for name, make in lists.items():
    for hole, deed in holes.items():
        for use, body in uses.items():
            text = (head.replace("BODY", body).replace("MAKE", make).replace("DEED", deed).replace("LIST", name.replace("-", " ")).replace("HOLE", hole.replace("-", " ")).replace("USE", use.replace("-", " ")))
            with open(os.path.join(out, "%s-%s-%s.ts" % (name, hole, use)), "w") as file:
                file.write(text)
            count += 1
print("%d programs in %s" % (count, out))
