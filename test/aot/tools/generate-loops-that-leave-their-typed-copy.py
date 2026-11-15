#!/usr/bin/env python3
# generate-loops-that-leave-their-typed-copy.py <folder>: all 273; ../parallel/loops-that-leave-their-typed-copy/ holds 8 of them: one-shape programs: a loop is bounded by the length of a typed array, and in the middle of some turn the array stops being as its class makes it.
# From the next turn on the loop goes by what the array answers then, with all that the turns before have left. Each program holds one loop, one deed and one turn. What is printed is primitive. The reference is `bun <file>`.
import os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

loops = {
    "a-sum": "let total = 0; for (let i = 0; i < view.length; i++) { between(i); total += view[i]; } return total;",
    "two-sums": 'let whole = 0, part = 0.5; for (let i = 0; i < view.length; i++) { between(i); whole += view[i]; part *= 1.5; } return whole + ":" + part;',
    "a-while": 'let i = 0, total = 0; while (i < view.length) { between(i); total += view[i]; i++; } return total + ":" + i;',
    "left-early": "let total = 0; for (let i = 0; i < view.length; i++) { between(i); if (view[i] === 4) break; total += view[i]; } return total;",
    "turns-passed-over": "let total = 0; for (let i = 0; i < view.length; i++) { between(i); if (view[i] === 2) continue; total += view[i]; } return total;",
    "a-loop-in-a-loop": "let total = 0; for (let i = 0; i < view.length; i++) { between(i); for (let j = 0; j < view.length; j++) total += view[j]; } return total;",
    "stores": 'for (let i = 0; i < view.length; i++) { between(i); view[i] = i * 2 + 1; } return Array.prototype.join.call(view, "");',
    "a-list-is-filled": 'const kept: unknown[] = []; for (let i = 0; i < view.length; i++) { between(i); kept.push(view[i]); } return kept.join("");',
    "a-text-grows": 'let said = ""; for (let i = 0; i < view.length; i++) { between(i); said += view[i] + ";"; } return said;',
    "under-a-handler": "let total = 0; for (let i = 0; i < view.length; i++) { try { between(i); total += view[i]; } catch { total += 100; } } return total;",
    "by-twos": "let total = 0; for (let i = 0; i < view.length; i += 2) { between(i); total += view[i]; } return total;",
    "a-second-counter": 'let total = 0, turns = 0; for (let i = 0; i < view.length; i++, turns += 3) { between(i); total += view[i]; } return total + ":" + turns;',
    "closures-of-the-turns": 'const kept: (() => number)[] = []; for (let i = 0; i < view.length; i++) { between(i); kept.push(() => i + view[i]); } return kept.map(one => one()).join("");',
}
deeds = {
    "a-shorter-length-of-its-own": 'Object.defineProperty(subject, "length", { value: 2, configurable: true });',
    "a-longer-length-of-its-own": 'Object.defineProperty(subject, "length", { value: 6, configurable: true });',
    "an-accessor-of-its-own": 'Object.defineProperty(subject, "length", { get() { reads++; return 3; }, configurable: true });',
    "another-prototype": "Object.setPrototypeOf(subject, { __proto__: Uint8Array.prototype, get length() { return 3; } });",
    "no-prototype": "Object.setPrototypeOf(subject, null);",
    "a-text-for-a-length": 'Object.defineProperty(subject, "length", { value: "3", configurable: true });',
    "its-buffer-is-handed-away": "subject.buffer.transfer();",
}

head = """// LOOP: DEED, in turn TURN
let subject: any;
let reads = 0;
let armed = false;
function between(i: number) { if (armed && i === TURN) { armed = false; HAPPENS } }
function ask(view: Uint8Array) { BODY }
function fresh() { const view = new Uint8Array(5); for (let i = 0; i < 5; i++) view[i] = i + 1; return view; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(String(ask(view))); } catch (error) { seen.push((error as Error).name); } }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
subject = fresh();
armed = true;
look(subject);
look(subject);
look(plain);
seen.push(reads);
console.log(seen.join());
"""
count = 0
for loop, body in loops.items():
    for deed, happens in deeds.items():
        for turn in (0, 2, 4):
            text = (head.replace("BODY", body).replace("HAPPENS", happens).replace("TURN", str(turn)).replace("LOOP", loop.replace("-", " ")).replace("DEED", deed.replace("-", " ")))
            with open(os.path.join(out, "%s-%s-in-turn-%d.ts" % (loop, deed, turn)), "w") as file:
                file.write(text)
            count += 1
print("%d programs in %s" % (count, out))
