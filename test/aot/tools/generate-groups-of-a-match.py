#!/usr/bin/env python3
# generate-groups-of-a-match.py <folder>: all 78; ../parallel/groups-of-a-match/ holds 16 of them: twelve that turn wrong where every group is taken to be there, four in which every group is. One program a pattern: every group of a match is read, measured and compared, over every text of up to four units of a small alphabet.
# A group that takes part in every match is cut out of the subject without a test for "undefined"; these patterns try that claim: groups under quantifiers, in alternatives, in assertions, behind back references, nested, empty, many.
import os, sys

patterns = [
    # name, source, flags
    ("plain", r"(a)", ""), ("optional", r"(a)?", ""), ("star", r"(a)*", ""), ("plus", r"(a)+", ""), ("once-in-braces", r"(a){1}", ""), ("once-to-once", r"(a){1,1}", ""),
    ("none-to-once", r"(a){0,1}", ""), ("twice", r"(a){2}", ""), ("once-to-twice", r"(a){1,2}", ""), ("none", r"(a){0}b", ""), ("lazy-optional", r"(a)??b", ""), ("lazy-plus", r"(a)+?", ""), ("lazy-star", r"(a)*?b", ""),
    ("two-alternatives", r"(a)|(b)", ""), ("alternatives-in-a-group", r"(?:(a)|(b))", ""), ("alternatives-in-a-capture", r"((a)|(b))", ""), ("one-alternative-captures", r"((a)|b)c", ""),
    ("alternatives-repeated", r"(?:(a)|b)+", ""), ("alternatives-repeated-or-none", r"(?:(a)|b)*c?", ""), ("plus-in-a-capture", r"((a)+)", ""), ("star-in-a-capture", r"((a)*)", ""), ("optional-in-a-capture", r"((a)?)", ""),
    ("capture-in-a-capture", r"((a))", ""), ("three-deep", r"(((a)))b?", ""),
    ("look-ahead", r"(?=(a))a", ""), ("negative-look-ahead", r"(?!(a))b", ""), ("look-behind", r"(?<=(a))b", ""), ("negative-look-behind", r"(?<!(a))b", ""), ("alternatives-in-a-look-ahead", r"(?=(a)|b).", ""),
    ("capture-around-a-look-ahead", r"((?=(a))a)", ""), ("capture-around-a-negative-look-ahead", r"((?!(a))b)", ""),
    ("back-reference", r"(a)\1", ""), ("forward-reference", r"\1(a)", ""), ("reference-across-alternatives", r"(?:\2(a)|(b))+", ""), ("reference-in-the-other-alternative", r"(a)|\1b", ""),
    ("at-the-start", r"^(a)", ""), ("at-the-start-or-another", r"^(a)|b", ""), ("at-the-end", r"(a)$", ""), ("two-anchored-alternatives", r"^(a)$|^(b)$", ""), ("optional-anchored", r"(?:^(a))?b", ""),
    ("may-be-empty", r"(a*)", ""), ("empty-repeated", r"(a*)*", ""), ("empty-repeated-once-or-more", r"(a*)+", ""), ("or-empty", r"(a|)", ""), ("empty-or", r"(|a)", ""), ("empty", r"()", ""), ("empty-star", r"()*", ""), ("empty-capture-or", r"(?:()|a)", ""),
    ("named", r"(?<x>a)", ""), ("named-optional", r"(?<x>a)?b", ""),
    ("optional-between", r"(a)(b)?(c)", ""), ("optional-pair-between", r"(a)(?:(b)(c))?(=)", ""), ("alternatives-between", r"(a)(?:(b)|(c))(=)", ""), ("group-once-in-braces", r"(?:(a)){1}", ""), ("group-twice", r"(?:(a)){2}", ""),
    ("group-plus", r"(?:(a))+", ""), ("groups-around", r"(?:(?:(a)))", ""), ("optional-group-in-front", r"(?:(a)b)?(c)", ""),
    ("optional-inside", r"(a(b)?)", ""), ("optional-outside", r"(a(b))?c?", ""), ("repeated-outside", r"(a(b)c)+", ""), ("star-in-front", r"(?:a(b))*(c)", ""), ("plus-keeps-the-last", r"(?:(a)|(b)|(c))+(=)", ""),
    ("resets-each-turn", r"(?:(a)?(b)?)+c", ""), ("greedy-gives-back", r"(a+)(a)", ""), ("lazy-takes-more", r"(a+?)(a*)b", ""), ("dot-star-around", r".*(a).*", ""), ("dot-star-in-front", r"^.*(a)(b)?", ""),
    ("ignores-case", r"(a)(B)?", "i"), ("many-lines", r"^(a)(b)?$", "m"), ("dot-takes-all", r"(.)(.)?", "s"), ("by-code-point", r"(\p{L})(\p{N})?", "u"), ("sticky", r"(a)(b)?", "y"), ("global", r"(a)(b)?", "g"), ("sets", r"([\p{L}--[b]])(b)?", "v"),
    ("seventeen", "".join(["(a?)"] * 16) + "(b)", ""), ("thirty-three", "".join(["(a)?"] * 32) + "(b)", ""), ("sixty-six", "(a)" + "".join(["(b)?"] * 64) + "(c)", ""),
]

head = '''// Every group of a match is read, measured and compared. What is printed is what plain Bun prints.
const unseen = (x: any): any => [x][JSON.parse("0")];
const alphabet: string[] = unseen(["a", "b", "c", "=", "A", "1", "\\n", "\\u4e2d"]);
function textsUpTo(length: number): string[] {
  let last = [""];
  const all = [""];
  for (let i = 0; i < length; i++) {
    const next: string[] = [];
    for (const text of last) for (const unit of alphabet) next.push(text + unit);
    all.push(...next);
    last = next;
  }
  return all;
}
'''

def numberOfGroups(source):
    count, i = 0, 0
    while i < len(source):
        if source[i] == "\\":
            i += 2
            continue
        if source[i] == "[":
            depth = 1
            i += 1
            while depth:
                if source[i] == "\\":
                    i += 1
                elif source[i] == "[":
                    depth += 1
                elif source[i] == "]":
                    depth -= 1
                i += 1
            continue
        if source[i] == "(" and (source[i + 1] != "?" or (source[i + 1:i + 3] == "?<" and source[i + 3] not in "=!")):
            count += 1
        i += 1
    return count

folder = sys.argv[1]
os.makedirs(folder, exist_ok=True)
for name, source, flags in patterns:
    groups = numberOfGroups(source)
    read = [g for g in range(groups + 1) if g < 63]
    told = " + \",\" + ".join("String(m[%d])" % g for g in read)
    measured = " + ".join("(m[%d] === undefined ? -1 : m[%d]!.length)" % (g, g) for g in read)
    compared = " + ".join("(m[%d] === \"a\" ? %d : 0)" % (g, g + 1) for g in read)
    length = 3 if groups > 16 else 4
    text = head + '''function told(text: string): string {
  const m = /%(source)s/%(flags)s.exec(text);
  if (!m) return "-";
  return %(told)s;
}
function measured(text: string): number {
  const m = /%(source)s/%(flags)s.exec(text);
  if (m === null) return -2;
  return %(measured)s;
}
function compared(text: string): number {
  const m = text.match(/%(source)s/%(matchFlags)s);
  return m ? %(compared)s + m.index! * 1000 + m.length * 100000 : -3;
}
let lengths = 0, sames = 0, hash = 0;
const seen = new Set<string>();
for (const text of textsUpTo(%(length)d)) {
  const groups = told(text);
  seen.add(groups);
  for (let i = 0; i < groups.length; i++) hash = (hash * 31 + groups.charCodeAt(i)) | 0;
  lengths += measured(text);
  sames = (sames * 7 + compared(text)) | 0;
}
console.log([...seen].sort().slice(0, 40).map(groups => JSON.stringify(groups)).join("\\n"));
console.log(seen.size, hash, lengths, sames);
''' % {"source": source, "flags": flags, "matchFlags": flags.replace("g", ""), "told": told, "measured": measured, "compared": compared, "length": length}
    open(os.path.join(folder, name + ".ts"), "w").write(text)
print(len(patterns), "programs")
