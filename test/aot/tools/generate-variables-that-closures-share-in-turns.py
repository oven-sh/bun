#!/usr/bin/env python3
# all 492; ../parallel/variables-that-closures-share-in-turns/ holds 7 of them.
"""Writes test/aot/parallel/variables-that-closures-share-in-turns: one loop over variables that closures share a program, one state of the variables a program.

`while (pos < end) { .. text.charCodeAt(pos) .. pos++ }`, as a scanner is written: pos, end, text and flags lie in an environment. Such a loop is built twice. At the
head of each turn of the typed copy the variables that the turn takes for int32s are read and tested; whatever else they hold, the turn begins again in the other copy.
Each program here brings one thing that does not fit, when the loop is entered or in the middle of its turns.

    python3 test/aot/tools/generate-variables-that-closures-share-in-turns.py test/aot/parallel/variables-that-closures-share-in-turns
"""
import os
import sys

FUEL = "if (++fuel > 60) break; "
LOOPS = {
    "a-comment-is-skipped": "while (pos < end) { FUEL const ch = at(pos); if (ch === 42 && at(pos + 1) === 47) { pos += 2; break; } pos++; if (ch === 10) { flags |= 1; lines++; } } return pos;",
    "a-word-is-skipped": "while (pos < end && at(pos) !== 32) { FUEL pos++; } return pos;",
    "the-step-is-worked-out": "while (pos < end) { FUEL pos += at(pos) > 100 ? 2 : 1; } return pos;",
    "a-closure-steps-in-a-turn": "while (pos < end) { FUEL if (at(pos) === 42) bump(); pos++; } return pos;",
    "a-closure-steps-in-every-turn": "while (pos < end) { FUEL bump(); flags |= pos; } return pos;",
    "the-variable-is-read-behind-its-store": "let last: any = -1; while (pos < end) { FUEL pos++; last = pos; flags |= pos; } return last;",
    "the-variable-is-stored-in-either-arm": "while (pos < end) { FUEL if (at(pos) === 42) pos += 2; else pos++; lines = pos; } return lines;",
    "the-variable-is-stored-in-one-arm": "while (pos < end) { FUEL if (at(pos) === 42) pos += 2; lines = pos; pos++; } return lines;",
    "unseen-code-runs-in-a-rare-arm": "while (pos < end) { FUEL if (at(pos) === 42) hook(); pos++; } return pos;",
    "unseen-code-runs-in-every-turn": "while (pos < end) { FUEL hook(); pos++; } return pos;",
    "the-bound-alone-is-shared": "let n = 0; for (let i = 0; i < end; i++) { FUEL n += at(i); flags ^= i; } return n;",
    "the-variable-goes-down": "while (pos > end) { FUEL pos--; flags += 1; } return pos;",
    "a-loop-inside": "while (pos < end) { FUEL let k = 0; while (k < 2) { k++; lines++; pos++; } } return pos;",
    "a-handler-in-the-turn": "while (pos < end) { FUEL try { if (at(pos) === 42) throw new Error(\"star\"); pos++; } catch { pos += 2; lines++; } } return pos;",
    "the-length-of-the-text-is-the-bound": "while (pos < text.length) { FUEL pos++; flags |= 2; } return pos;",
    "the-variable-is-handed-on": "let sum: any = 0; while (pos < end) { FUEL sum += pos; pos++; } return sum;",
    "the-variable-is-an-index": "const list = [5, 6, 7, 8, 9, 10, 11, 12, 13]; let sum: any = 0; while (pos < end) { FUEL sum += list[pos]; pos++; } return sum;",
    "the-flags-are-tested-behind-the-step": "while (pos < end) { FUEL pos++; if (flags & 4) lines++; flags <<= 1; } return flags;",
}

TEXT = "\"ab*c\\nde * f*/ tail\""
# name: what set() is handed: text, pos, end, flags
STATES = {
    "all-as-written": (TEXT, "0", "19", "0"),
    "the-position-is-a-fraction": (TEXT, "0.5", "19", "0"),
    "the-position-is-a-text": (TEXT, "\"0\"", "19", "0"),
    "the-position-is-undefined": (TEXT, "undefined", "19", "0"),
    "the-position-is-null": (TEXT, "null", "19", "0"),
    "the-position-is-negative": (TEXT, "-3", "19", "0"),
    "the-position-is-minus-zero": (TEXT, "-0", "19", "0"),
    "the-position-is-not-a-number": (TEXT, "NaN", "19", "0"),
    "the-position-is-a-big-integer": (TEXT, "0n", "19", "0"),
    "the-position-is-an-object": (TEXT, "{ valueOf() { said.push(\"asked\"); return 1; } }", "19", "0"),
    "the-position-stands-at-the-end-of-int32": (TEXT, "2147483640", "2147483660", "0"),
    "the-position-stands-at-the-other-end-of-int32": (TEXT, "-2147483640", "-2147483660", "0"),
    "the-bound-is-a-fraction": (TEXT, "0", "7.5", "0"),
    "the-bound-is-a-text": (TEXT, "0", "\"9\"", "0"),
    "the-bound-is-undefined": (TEXT, "0", "undefined", "0"),
    "the-bound-is-infinite": (TEXT, "0", "Infinity", "0"),
    "the-bound-is-an-object-that-moves-the-position": (TEXT, "0", "{ valueOf() { said.push(\"asked\"); if (said.length === 4) made.poke(9); return 14; } }", "0"),
    "the-flags-are-undefined": (TEXT, "0", "19", "undefined"),
    "the-flags-are-a-fraction": (TEXT, "0", "19", "0.5"),
    "the-flags-are-a-text": (TEXT, "0", "19", "\"4\""),
    "the-flags-stand-at-the-end-of-int32": (TEXT, "0", "19", "2147483647"),
    "the-flags-are-an-object-that-moves-the-position": (TEXT, "0", "19", "{ valueOf() { said.push(\"asked\"); made.poke(12); return 4; } }"),
    "the-text-is-joined": ("[\"ab*c\\nde \", \"* f*/ tail\"].reduce((a, b) => a + b + \"\")", "0", "19", "0"),
    "the-text-has-wide-letters": ("\"ab*c\\nd\\u4e2d * f*/ tail\"", "0", "19", "0"),
    "the-text-is-an-object": ("{ length: 9, charCodeAt(p: any) { said.push(\"at \" + p); if (p === 3) made.poke(6); return 42; } }", "0", "9", "0"),
    "the-text-is-undefined": ("undefined", "0", "19", "0"),
    "the-text-is-short": ("\"ab\"", "0", "19", "0"),
}
HOOKS = {
    "": "(made) => {}",
    "-and-the-hook-stores-a-fraction": "(made) => { made.poke(made.peek() + 1.5); }",
    "-and-the-hook-stores-a-text": "(made) => { made.poke(String(made.peek())); }",
    "-and-the-hook-moves-the-bound": "(made) => { made.bound(8); }",
}

PROGRAM = """// WORDS
const said: string[] = [];
function show(value: any): string { return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" && value ? "an object" : String(value); }
function create() {
  var text: string; var pos: number; var end: number; var flags: number; var lines = 0;
  const hooked = (0, eval)(HOOK);
  function hook() { hooked(made); }
  function at(p: number) { return text.charCodeAt(p); }
  function bump() { pos++; }
  function work(): any { let fuel = 0; LOOP }
  function set(t: any, p: any, e: any, f: any) { text = t; pos = p; end = e; flags = f; }
  return { work, set, bump, peek: () => pos, poke: (value: any) => { pos = value; }, bound: (value: any) => { end = value; }, all: () => [pos, end, flags, lines].map(show).join(" ") };
}
const made = create();
(globalThis as any).keptOutside = made;
for (const state of [() => made.set(FIRST), () => made.set(SECOND), () => made.set(FIRST)]) {
  state();
  try {
    console.log(show(made.work()));
  } catch (error) {
    console.log("thrown: " + (error as Error).name);
  }
  console.log(made.all());
}
console.log(said.join(", "));
export {};
"""


def main():
    folder = sys.argv[1]
    os.makedirs(folder, exist_ok=True)
    count = 0
    first = ", ".join(STATES["all-as-written"])
    for loop_name, loop in LOOPS.items():
        for state_name, state in STATES.items():
            hooks = HOOKS if "unseen-code" in loop_name and state_name == "all-as-written" else {"": HOOKS[""]}
            for hook_name, hook in hooks.items():
                text = PROGRAM.replace("WORDS", loop_name.replace("-", " ") + ": " + state_name.replace("-", " ") + hook_name.replace("-", " "))
                text = text.replace("LOOP", loop.replace("FUEL", FUEL)).replace("HOOK", "\"" + hook.replace("\"", "\\\"") + "\"").replace("FIRST", first).replace("SECOND", ", ".join(state))
                with open(os.path.join(folder, loop_name + "-where-" + state_name + hook_name + ".ts"), "w") as file:
                    file.write(text)
                count += 1
    print(count, "programs")


main()
