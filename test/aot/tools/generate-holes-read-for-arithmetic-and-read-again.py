#!/usr/bin/env python3
# generate-holes-read-for-arithmetic-and-read-again.py <folder>: all 126; ../parallel/holes-read-for-arithmetic-and-read-again/ holds 2 of them: one-shape programs: in one turn of a loop over a list of numbers with holes the element is read for arithmetic (where a hole may be read as NaN) AND READ AGAIN by somebody who can tell undefined from NaN.
import sys, os
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
sums = {"plus": "t += list[i];", "minus": "t -= list[i];", "times": "t *= list[i];", "divided": "t /= list[i];", "plus-in-front": "t = list[i] + t;"}
again = {
    "is-it-undefined": "if (list[i] === undefined) n++;", "kept": "last = list[i];", "typeof": 'if (typeof list[i] === "undefined") n++;', "or-else": "last = list[i] ?? -1;",
    "pushed": "kept.push(list[i]);", "as-text": "text += String(list[i]) + \",\";", "is-it-nan": "if (Number.isNaN(list[i])) n++;", "is-it-void": "if (list[i] == null) n++;", "handed-on": "n += tell(list[i]);",
}
lists = {"int32s": "[1, 2, 3, 4, 5, 6]", "fractions": "[1.5, 2.5, 3.5, 4.5, 5.5, 6.5]"}
orders = {"the-sum-first": lambda s, a: s + " " + a, "the-sum-last": lambda s, a: a + " " + s, "the-sum-between": lambda s, a: a + " " + s + " " + a}
n = 0
for listName, literal in lists.items():
    for sumName, s in sums.items():
        for againName, a in again.items():
            for orderName, order in orders.items():
                if sumName != "plus" and orderName != "the-sum-first": continue
                text = f"""function tell(x: unknown): number {{ return x === undefined ? 1 : 0; }}
function run(list: number[]): string {{
  let t = 1, n = 0, text = "";
  let last: unknown = "none";
  const kept: unknown[] = [];
  for (let i = 0; i < list.length; i++) {{ {order(s, a)} }}
  return [t, n, String(last), text, kept.map(String).join("|")].join(":");
}}
const holed: number[] = {literal};
delete holed[3];
delete holed[5];
const whole: number[] = {literal};
const seen: string[] = [];
for (let k = 0; k < 3; k++) seen.push(run(holed));
seen.push(run(whole));
console.log(seen.join("\\n"));
"""
                open(os.path.join(out, f"{listName}-{sumName}-{againName}-{orderName}.ts"), "w").write(text); n += 1
print(n, "programs")
