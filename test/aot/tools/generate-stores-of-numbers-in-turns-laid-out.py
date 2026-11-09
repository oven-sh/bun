#!/usr/bin/env python3
"""Writes test/aot/parallel/stores-of-numbers-in-turns-laid-out: one counted loop that stores a number into a list or into a view a program.

The turns of such a loop are laid out eight at a time. A turn laid out that leaves is taken again from its start by the loop as it is written, so behind a store
no edge may leave the turn. Each program here brings one thing at one place of a group of eight, the first and the last among them:
a turn that leaves in front of its store (the largest int32, a fraction, a hole) . a turn that leaves behind its store, which must stay as it is written .
a later turn that reads what an earlier turn has stored, through the same list or view or through another view of the same buffer .
a counter that is itself stored and crosses either end of int32 . a view shorter than the bound. Each prints everything that was stored and how far it came.

    python3 test/aot/tools/generate-stores-of-numbers-in-turns-laid-out.py test/aot/parallel/stores-of-numbers-in-turns-laid-out
"""
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
made = []
def program(name, text):
    made.append(name); open(os.path.join(out, name + ".ts"), "w").write(text.strip() + "\n")
LENGTHS = (7, 8, 9, 16, 17, 24, 31)
# the misfit at place k makes the turn leave in front of its store: a hole, a fraction among whole numbers, the largest int32 (the sum is none)
for length in (16, 24):
    for place in list(range(0, 9)) + [15, length - 1]:
        for what, misfit in (("the-largest-int32", "2147483647"), ("a-fraction", "0.5"), ("a-hole", None)):
            set_ = f"delete list[{place}];" if misfit is None else f"list[{place}] = {misfit};"
            program(f"one-is-added-to-each-of-{length}-and-{what}-stands-at-{place}", f"""
function bump(list: number[]): void {{ for (let i = 0; i < list.length; i++) list[i] = list[i] + 1; }}
const list: number[] = [];
for (let i = 0; i < {length}; i++) list.push(i * 3);
bump(list);
{set_}
bump(list); bump(list);
console.log(JSON.stringify(list), list.length);
""")
for length in LENGTHS:
    program(f"the-counter-is-stored-into-{length}", f"""
function fill(list: number[]): void {{ for (let i = 0; i < list.length; i++) list[i] = i; }}
const list: number[] = [];
for (let i = 0; i < {length}; i++) list.push(-1);
fill(list);
console.log(JSON.stringify(list));
""")
    program(f"fractions-are-stored-into-{length}", f"""
function fill(list: number[], from: number): void {{ for (let i = 0; i < list.length; i++) list[i] = from * 0.5 + i; }}
const list: number[] = [];
for (let i = 0; i < {length}; i++) list.push(0.5);
fill(list, 3); console.log(JSON.stringify(list));
fill(list, NaN); console.log(JSON.stringify(list));
fill(list, Infinity); console.log(JSON.stringify(list));
""")
    program(f"what-was-stored-a-turn-ago-is-read-in-{length}", f"""
function run(list: number[]): void {{ for (let i = 1; i < list.length; i++) list[i] = list[i - 1] + i; }}
const list: number[] = [];
for (let i = 0; i < {length}; i++) list.push(1);
run(list); run(list);
console.log(JSON.stringify(list));
""")
    program(f"what-a-later-turn-stores-is-read-first-in-{length}", f"""
function run(list: number[]): void {{ for (let i = 0; i < list.length - 1; i++) list[i] = list[i + 1] + 1; }}
const list: number[] = [];
for (let i = 0; i < {length}; i++) list.push(i * i);
run(list); run(list);
console.log(JSON.stringify(list));
""")
    for view in ("Uint8Array", "Int32Array", "Float64Array", "Float32Array", "Uint8ClampedArray", "Int16Array"):
        program(f"a-{view}-of-{length}-is-read-and-written", f"""
function run(view: {view}): number {{ let total = 0; for (let i = 0; i < view.length; i++) {{ total += view[i]; view[i] = view[i] * 3 + 1.5; }} return total; }}
const view = new {view}({length});
for (let i = 0; i < {length}; i++) view[i] = i * 37 - 100;
console.log(run(view), run(view), Array.from(view).join());
""")
    program(f"two-views-of-one-buffer-of-{length}", f"""
function run(bytes: Uint8Array, words: Uint16Array): number {{ let total = 0; for (let i = 0; i < words.length; i++) {{ total += bytes[i + 1]; words[i] = total; }} return total; }}
const buffer = new ArrayBuffer({length} * 2 + 2);
const bytes = new Uint8Array(buffer), words = new Uint16Array(buffer);
for (let i = 0; i < bytes.length; i++) bytes[i] = i * 7 + 1;
console.log(run(bytes, words), Array.from(bytes).join());
""")
    program(f"a-view-shorter-than-the-bound-{length}", f"""
function run(view: Int32Array, n: number): void {{ for (let i = 0; i < n; i++) view[i] = i * 2 + 1; }}
const view = new Int32Array({length});
run(view, {length} + 11);
console.log(Array.from(view).join(), view.length);
""")
# two views of one buffer: a later turn of a group reads what an earlier turn has stored through the other view
for length in LENGTHS:
    for view, size in (("Int32Array", 4), ("Float64Array", 8), ("Uint8Array", 1), ("Int16Array", 2)):
        program(f"a-{view}-of-{length}-shifted-by-one-over-the-same-buffer", f"""
function run(from: {view}, into: {view}): void {{ for (let i = 0; i < from.length; i++) into[i] = from[i] + 1; }}
const buffer = new ArrayBuffer(({length} + 1) * {size});
const from = new {view}(buffer, 0, {length}), into = new {view}(buffer, {size}, {length});
from[0] = 5;
run(from, into); run(from, into);
console.log(Array.from(new {view}(buffer)).join());
""")
    program(f"words-of-{length}-written-over-the-bytes-that-are-read", f"""
function run(bytes: Uint8Array, words: Uint16Array): void {{ for (let i = 0; i < words.length; i++) words[i] = bytes[i + 1] + 259; }}
const buffer = new ArrayBuffer({length} * 2 + 2);
const bytes = new Uint8Array(buffer), words = new Uint16Array(buffer);
for (let i = 0; i < bytes.length; i++) bytes[i] = i * 7 + 1;
run(bytes, words); run(bytes, words);
console.log(Array.from(bytes).join());
""")
    program(f"a-view-of-{length}-takes-what-the-turn-before-stored", f"""
function run(view: Int32Array): void {{ for (let i = 1; i < view.length; i++) view[i] = view[i - 1] + i; }}
const view = new Int32Array({length});
view[0] = 3;
run(view); run(view);
console.log(Array.from(view).join());
""")
# the same with views that never leave their function: there the walk proves them, and the head of the loop holds the counter against a bound from in front of it
for length in LENGTHS:
    for view, size in (("Int32Array", 4), ("Float64Array", 8), ("Uint8Array", 1), ("Int16Array", 2)):
        program(f"a-local-{view}-of-{length}-shifted-by-one-over-the-same-buffer", f"""
function main(): void {{
  const buffer = new ArrayBuffer(({length} + 1) * {size});
  const from = new {view}(buffer, 0, {length}), into = new {view}(buffer, {size}, {length}), all = new {view}(buffer);
  from[0] = 5;
  for (let round = 0; round < 2; round++) for (let i = 0; i < {length}; i++) into[i] = from[i] + 1;
  let said = "";
  for (let i = 0; i < {length} + 1; i++) said += all[i] + ",";
  console.log(said);
}}
main();
""")
    program(f"local-words-of-{length}-written-over-the-bytes-that-are-read", f"""
function main(): void {{
  const buffer = new ArrayBuffer({length} * 2 + 2);
  const bytes = new Uint8Array(buffer), words = new Uint16Array(buffer);
  for (let i = 0; i < {length} * 2 + 2; i++) bytes[i] = i * 7 + 1;
  for (let round = 0; round < 2; round++) for (let i = 0; i < {length}; i++) words[i] = bytes[i + 1] + 259;
  let said = "";
  for (let i = 0; i < {length} * 2 + 2; i++) said += bytes[i] + ",";
  console.log(said);
}}
main();
""")
    program(f"a-local-view-of-{length}-takes-what-the-turn-before-stored", f"""
function main(): void {{
  const view = new Int32Array({length});
  view[0] = 3;
  for (let round = 0; round < 2; round++) for (let i = 1; i < {length}; i++) view[i] = view[i - 1] + i;
  let said = "";
  for (let i = 0; i < {length}; i++) said += view[i] + ",";
  console.log(said);
}}
main();
""")
# behind the store the turn may leave: begun again it would store twice
for length in (16, 24):
    for place in (0, 1, 6, 7, 8, 9, 15, length - 1):
        program(f"the-turn-leaves-behind-its-store-at-{place}-of-{length}", f"""
function bump(list: number[], stop: number): number {{ let i = 0; for (; i < list.length; i++) {{ list[i] = list[i] + 1; if (list[i] === stop) break; }} return i; }}
const list: number[] = [];
for (let i = 0; i < {length}; i++) list.push(i * 3);
console.log(bump(list, {place} * 3 + 1), JSON.stringify(list));
console.log(bump(list, -1), JSON.stringify(list));
""")
        program(f"the-turn-of-a-view-leaves-behind-its-store-at-{place}-of-{length}", f"""
function bump(view: Int32Array, stop: number): number {{ let i = 0; for (; i < view.length; i++) {{ view[i] = view[i] + 1; if (view[i] === stop) break; }} return i; }}
const view = new Int32Array({length});
for (let i = 0; i < {length}; i++) view[i] = i * 3;
console.log(bump(view, {place} * 3 + 1), Array.from(view).join());
console.log(bump(view, -1), Array.from(view).join());
""")
for length in (16, 24):
    for place in (0, 1, 6, 7, 8, 9, 15, length - 1):
        for view in ("Int32Array", "Float64Array"):
            program(f"the-turn-of-a-local-{view}-leaves-behind-its-store-at-{place}-of-{length}", f"""
function main(): void {{
  const view = new {view}({length});
  for (let i = 0; i < {length}; i++) view[i] = i * 3;
  let reached = 0;
  for (let i = 0; i < {length}; i++) {{ view[i] = view[i] + 1; reached = i; if (view[i] === {place} * 3 + 1) break; }}
  let said = reached + ":";
  for (let i = 0; i < {length}; i++) said += view[i] + ",";
  console.log(said);
}}
main();
""")
# the counter is stored and crosses the end of int32, at every place of a group
for first in range(2147483647 - 20, 2147483647 - 3, 2):
    program(f"the-counter-is-stored-from-{first}-across-the-end-of-int32", f"""
function fill(list: number[], from: number, to: number): void {{ for (let i = from; i < to; i++) list[i - from] = i; }}
const list: number[] = [];
for (let i = 0; i < 32; i++) list.push(0);
fill(list, {first}, {first} + 32);
console.log(JSON.stringify(list));
""")
for first in (-2147483648 + 20, -2147483648 + 9, -2147483648 + 8, -2147483648 + 1):
    program(f"the-counter-is-stored-down-from-{first + 2147483648}-above-the-start-of-int32", f"""
function fill(list: number[], from: number, to: number): void {{ for (let i = from; i > to; i--) list[from - i] = i; }}
const list: number[] = [];
for (let i = 0; i < 32; i++) list.push(0);
fill(list, {first}, {first} - 32);
console.log(JSON.stringify(list));
""")
print(len(made), "programs")
