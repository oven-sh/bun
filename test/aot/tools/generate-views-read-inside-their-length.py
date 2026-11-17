#!/usr/bin/env python3
# generate-views-read-inside-their-length.py <folder>: all 540; ../parallel/views-read-inside-their-length/ holds 8 of them: one-shape programs: a position is held against the length of a typed array, and then the array is read or written there.
# Each program holds one way to ask for the bound, one way to come by the position, one access, one kind of view, and one thing that happens between the question and the access.
# What is printed is primitive. The reference is `bun <file>`.
import os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

single = {
    "below-the-length": "if (k < view.length) { between(); return ACCESS(k); }",
    "the-length-above": "if (view.length > k) { between(); return ACCESS(k); }",
    "at-most-the-last": "if (k <= view.length - 1) { between(); return ACCESS(k); }",
    "at-most-the-length": "if (k <= view.length) { between(); return ACCESS(k); }",
    "below-the-length-kept-in-a-name": "const n = view.length; if (k < n) { between(); return ACCESS(k); }",
    "not-at-or-above-the-length": "if (!(k >= view.length)) { between(); return ACCESS(k); }",
    "below-the-length-of-another": "if (k < longer.length) { between(); return ACCESS(k); }",
    "the-next-one": "if (k < view.length) { between(); return ACCESS(k + 1); }",
}
positions = {
    "as-it-comes": "i",
    "as-an-unsigned-integer": "i >>> 0",
    "as-an-integer": "i | 0",
}
loops = {
    "in-a-loop": 'let said = ""; for (let j = 0; j < view.length; j++) { between(); said += ACCESS(j) + ";"; } return said;',
    "in-a-loop-downward": 'let said = ""; for (let j = view.length - 1; j >= 0; j--) { between(); said += ACCESS(j) + ";"; } return said;',
    "in-a-loop-by-twos": 'let said = ""; for (let j = i & 1; j < view.length; j += 2) { between(); said += ACCESS(j) + ";"; } return said;',
}
accesses = {
    "read": "view[X]",
    "stored": "(view[X] = 9)",
    "added-to": "(view[X] += 2)",
}
views = {
    "that-follows-its-buffer": "new Uint8Array(buffer)",
    "of-a-fixed-length": "new Uint8Array(buffer, 0, 8)",
}
deeds = {
    "nothing-happens": "",
    "the-buffer-shrinks": "buffer.resize(2);",
    "the-buffer-shrinks-to-nothing": "buffer.resize(0);",
    "the-buffer-is-handed-away": "buffer.transfer();",
    "the-buffer-grows": "buffer.resize(12);",
    "the-buffer-shrinks-by-code-out-of-sight": "(globalThis as any).deeds[0]();",
    "the-buffer-shrinks-through-another-view": "(longer.buffer as ArrayBuffer).resize(2);",
}

head = """// BOUND, the position POSITION, ACCESSED, a view VIEW: DEED
const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
const made = MAKE;
const longer = new Uint8Array(buffer, 0);
const apart = new Uint8Array(12);
for (let i = 0; i < 8; i++) made[i] = i + 1;
(globalThis as any).deeds = [() => buffer.resize(2)];
let turns = 0;
function between() { if (++turns === WHEN) { HAPPENS } }
function ask(view: Uint8Array, i: number) { ASK return "outside"; }
const seen: unknown[] = [];
for (const i of [0, 1, 7, 3, 1, 8, -1, 1.5, NaN, 4294967296, 2]) { try { seen.push(String(ask(made, i))); } catch (error) { seen.push((error as Error).name); } }
try { buffer.resize(16); seen.push(new Uint8Array(buffer).join("")); } catch (error) { seen.push((error as Error).name); }
console.log(seen.join());
"""

count = 0
def write(bound, position, access, view, deed, ask, when):
    global count
    text = ask
    while "ACCESS(" in text:
        start = text.index("ACCESS(")
        end = text.index(")", start)
        text = text[:start] + accesses[access].replace("X", text[start + 7:end]) + text[end + 1:]
    body = (head.replace("ASK", text).replace("MAKE", views[view]).replace("HAPPENS", deeds[deed]).replace("WHEN", str(when))
        .replace("BOUND", bound.replace("-", " ")).replace("POSITION", position.replace("-", " ")).replace("ACCESSED", access.replace("-", " ")).replace("VIEW", view.replace("-", " ")).replace("DEED", deed.replace("-", " ")))
    if bound == "below-the-length-of-another":
        body = body.replace("k < longer.length", "k < apart.length")
    name = "-".join(part for part in (bound, position, access, view, deed) if part)
    with open(os.path.join(out, name + ".ts"), "w") as file:
        file.write(body)
    count += 1

for access in accesses:
    for view in views:
        if access != "read" and view != "that-follows-its-buffer":
            continue
        for deed in deeds:
            if access != "read" and deed not in ("nothing-happens", "the-buffer-shrinks", "the-buffer-is-handed-away"):
                continue
            for bound, ask in single.items():
                for position, text in positions.items():
                    write(bound, position, access, view, deed, "const k = %s; %s" % (text, ask), 3)
            for bound, ask in loops.items():
                write(bound, "", access, view, deed, ask, 5)
print("%d programs in %s" % (count, out))
