#!/usr/bin/env python3
"""Writes test/aot/parallel/a-switch-over-written-texts-and-every-kind-of-string: one set of keys and one form of switch a program.

Every key and its near misses arrive as every kind of string that the engine has, made at run time: flat 8-bit . flat 16-bit without a unit above 0xFF (out of a
UTF-16 buffer; `("\\u20ac" + s).substring(1)` is an 8-bit atom, as jscDescribe() of bun:jsc says) . an 8-bit rope . a slice of one . an 8-bit substring . a 16-bit
substring . a 16-bit rope; and what is no string at all. Among the near misses: a unit above 0xFF whose low byte spells the key's character, the key twice and three times over.
BY SHAPE: sets of keys as programs write them. BY LENGTH: 1, 2, 3 or 5 keys of one length, that differ at the head, in the middle or at the end, for 27 lengths a program each,
and every length from 1 to 300, ten lengths a program. There a rope that holds the head of another key is asked for in front of each subject.
Each program prints every answer in order.

    python3 test/aot/tools/generate-a-switch-over-written-texts-and-every-kind-of-string.py test/aot/parallel/a-switch-over-written-texts-and-every-kind-of-string
"""
import os, sys, json
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
made = []
def program(name, text):
    made.append(name); open(os.path.join(out, name + ".ts"), "w").write(text.strip() + "\n")
many = []
for i in range(70):
    many.append("".join(chr(97 + (i * 7 + j * 3) % 26) for j in range(1 + i % 20)) + str(i))
KEYS = {
  "two-of-different-lengths": ["content-type", "authorization"],
  "two-of-one-length": ["user-agent", "connection"],
  "three-of-one-length": ["user-agent", "connection", "keep-alive"],
  "eight-header-names": ["content-type", "content-length", "accept", "authorization", "host", "user-agent", "connection", "cookie"],
  "one-length-that-differ-at-the-end": ["content-typa", "content-typb", "content-typc", "content-typd"],
  "one-length-that-differ-at-the-head": ["aontent-type", "bontent-type", "content-type"],
  "one-length-that-differ-in-the-middle": ["contentAtype", "contentBtype"],
  "lengths-round-the-words": ["a", "ab", "abc", "abcd", "abcde", "abcdefg", "abcdefgh", "abcdefghi", "abcdefghijklmno", "abcdefghijklmnop", "abcdefghijklmnopq"],
  "lengths-round-the-limit-of-what-is-compared-in-place": ["x" * 31, "y" * 32, "z" * 33, "w" * 40, "y" * 31 + "!", "z" * 32 + "!"],
  "the-empty-text-among-them": ["", "host", "content-length"],
  "all-short": ["get", "put", "post", "head", "delete", "options"],
  "short-and-long": ["get", "post", "content-disposition", "x"],
  "units-from-0x80-to-0xff": ["café-au-lait", "naïve-texts", "ÿÿÿÿÿÿÿÿÿ", "plain-ascii-key"],
  "a-text-that-only-a-16-bit-string-equals": ["h€st-and-more", "host-and-more", "content-length"],
  "seventy": many,
}
def misses(k):
    r = [k]
    if k:
        r += [k[:-1] + ("!" if k[-1] != "!" else "?"), ("!" if k[0] != "!" else "?") + k[1:], k[:-1], k.upper() if k.upper() != k else k + "_", k[:len(k) // 2] + "Ā" + k[len(k) // 2 + 1:]]
    r += [k + "x"]
    return r
HEAD = """const texts: string[] = JSON.parse({texts});
const subjects: unknown[] = [];
for (const text of texts) {{
  subjects.push(text);
  subjects.push(Buffer.from(text, "utf16le").toString("utf16le"));
  const half = text.length >> 1;
  subjects.push(text.slice(0, half) + text.slice(half));
  subjects.push((JSON.parse(JSON.stringify("<<" + text + ">>")) as string).slice(2, 2 + text.length));
  subjects.push((JSON.parse(JSON.stringify("\\u20ac" + text)) as string).slice(1));
  subjects.push(Buffer.from(text.slice(0, half), "utf16le").toString("utf16le") + text.slice(half));
}}
subjects.push(0, 1.5, -0, NaN, null, undefined, true, false, {{}}, [], ["host"], new String("host"), Symbol("host"), 10n, () => "host");
"""
for name, keys in KEYS.items():
    texts = []
    for k in keys:
        for m in misses(k):
            if m not in texts: texts.append(m)
    head = HEAD.format(texts=json.dumps(json.dumps(texts)))
    cases = "\n".join(f"    case {json.dumps(k)}: return {i + 1};" for i, k in enumerate(keys))
    program(f"{name}-in-a-function", head + f"""function classify(subject: unknown, depth: number): number {{
  if (depth > 0) return classify(subject, depth - 1);
  switch (subject) {{
{cases}
    default: return 0;
  }}
}}
const answers: number[] = [];
for (const subject of subjects) answers.push(classify(subject, 1));
console.log(answers.join(""));
""")
    program(f"{name}-of-what-is-written-a-string", head + f"""function classify(subject: string, depth: number): number {{
  if (depth > 0) return classify(subject, depth - 1);
  switch (subject) {{
{cases}
    default: return 0;
  }}
}}
const answers: number[] = [];
for (const subject of subjects) answers.push(classify(subject as string, 1));
console.log(answers.join(""));
""")
    inLoop = "\n".join(f"    case {json.dumps(k)}: answer = {i + 1}; break;" for i, k in enumerate(keys))
    program(f"{name}-in-a-loop", head + f"""const answers: number[] = [];
for (let i = 0; i < subjects.length; i++) {{
  let answer = 0;
  switch (subjects[i]) {{
{inLoop}
  }}
  answers.push(answer);
}}
console.log(answers.join(""));
""")
    if len(keys) <= 12:
        row = " || ".join(f"subject === {json.dumps(k)}" for k in keys)
        program(f"{name}-as-a-row-of-equalities", head + f"""function isKnown(subject: unknown, depth: number): boolean {{
  if (depth > 0) return isKnown(subject, depth - 1);
  return {row};
}}
const answers: number[] = [];
for (const subject of subjects) answers.push(isKnown(subject, 1) ? 1 : 0);
console.log(answers.join(""));
""")
        through = "\n".join(f"    case {json.dumps(k)}:" + (f" answer += {i + 1};" if i % 2 else "") + (" break;" if i % 3 == 2 else "") for i, k in enumerate(keys[: len(keys) // 2])) + "\n    default: answer += 100;\n" + "\n".join(f"    case {json.dumps(k)}: answer += {i + 50};" + (" break;" if i % 2 else "") for i, k in enumerate(keys[len(keys) // 2:]))
        program(f"{name}-that-falls-through-with-the-default-in-the-middle", head + f"""function classify(subject: unknown, depth: number): number {{
  if (depth > 0) return classify(subject, depth - 1);
  let answer = 0;
  switch (subject) {{
{through}
  }}
  return answer;
}}
const answers: number[] = [];
for (const subject of subjects) answers.push(classify(subject, 1));
console.log(answers.join(","));
""")
# A rope and a 16-bit string are written down as 8-bit characters for the compares. A unit above 0xFF has no such character, WHATEVER ITS LOW BYTE SPELLS; a string longer than what is written down equals no text that is compared in place.
def raised(k):
    r = [k]
    for at in sorted({0, len(k) // 2, len(k) - 1}):
        for by in (0x100, 0x2000, 0xFF00):
            r.append(k[:at] + chr(ord(k[at]) + by) + k[at + 1:])
    r += [k + k, k + "\u0100", k * 3]
    return r
for name in ("two-of-different-lengths", "eight-header-names", "all-short", "lengths-round-the-words", "lengths-round-the-limit-of-what-is-compared-in-place", "units-from-0x80-to-0xff"):
    keys = KEYS[name]
    texts = []
    for k in keys:
        for m in raised(k):
            if m not in texts: texts.append(m)
    head = HEAD.format(texts=json.dumps(json.dumps(texts)))
    cases = "\n".join(f"    case {json.dumps(k)}: return {i + 1};" for i, k in enumerate(keys))
    program(f"{name}-and-units-above-0xff-whose-low-bytes-spell-them-in-a-function", head + f"""function classify(subject: unknown, depth: number): number {{
  if (depth > 0) return classify(subject, depth - 1);
  switch (subject) {{
{cases}
    default: return 0;
  }}
}}
const answers: number[] = [];
for (const subject of subjects) answers.push(classify(subject, 1));
console.log(answers.join(""));
""")
    inLoop = "\n".join(f"    case {json.dumps(k)}: answer = {i + 1}; break;" for i, k in enumerate(keys))
    program(f"{name}-and-units-above-0xff-whose-low-bytes-spell-them-in-a-loop", head + f"""const answers: number[] = [];
for (let i = 0; i < subjects.length; i++) {{
  let answer = 0;
  switch (subjects[i]) {{
{inLoop}
  }}
  answers.push(answer);
}}
console.log(answers.join(""));
""")
# LENGTHS x HOW MANY TEXTS HAVE ONE LENGTH x WHERE THEY DIFFER. From three texts of one length on, the switch reads a word of the subject's characters to tell them apart, whatever their length; a rope and a 16-bit string
# have their characters written down only as far as the room for them goes. In front of each subject comes a rope that leaves the head of ANOTHER text in that room: whoever reads what was not written down finds that.
ONE_LENGTH_HEAD = """const keys: string[] = JSON.parse({keys});
const texts: string[] = JSON.parse({texts});
function kindsOf(text: string): unknown[] {{
  const half = text.length >> 1;
  return [
    text,
    Buffer.from(text, "utf16le").toString("utf16le"),
    text.slice(0, half) + text.slice(half),
    (text.slice(0, half) + text.slice(half)).slice(0),
    (JSON.parse(JSON.stringify("<<" + text + ">>")) as string).slice(2, 2 + text.length),
    (JSON.parse(JSON.stringify("\\u20ac" + text)) as string).slice(1),
    Buffer.from(text.slice(0, half), "utf16le").toString("utf16le") + text.slice(half),
  ];
}}
function headOf(text: string, length: number): string {{ const head = text.slice(0, length); const half = head.length >> 1; return head.slice(0, half) + head.slice(half); }}
"""
def textsOfOneLength(length, count, where):
    base = "".join(chr(97 + (i * 7 + 3) % 26) for i in range(length))
    at = {"at-the-head": 0, "in-the-middle": length // 2, "at-the-end": length - 1}[where]
    return [base[:at] + "ABCDEFG"[j] + base[at + 1:] for j in range(count)], at, base
for length in (1, 2, 3, 4, 5, 7, 8, 9, 12, 16, 17, 24, 31, 32, 33, 34, 36, 48, 64, 65, 100, 127, 128, 129, 130, 160, 300):
    for count in (1, 2, 3, 5):
        for where in ("at-the-head", "in-the-middle", "at-the-end"):
            if (count == 1 or length == 1) and where != "at-the-head": continue
            if length == 2 and where == "in-the-middle": continue
            keys, at, base = textsOfOneLength(length, count, where)
            texts = list(keys) + [base, base[:at] + "Z" + base[at + 1:], keys[0] + "x", keys[-1][:-1], keys[0][:-1] + ("?" if keys[0][-1] != "?" else "!")]
            texts = [t for n, t in enumerate(texts) if t not in texts[:n]]
            cases = "\n".join(f"    case {json.dumps(k)}: return {i + 1};" for i, k in enumerate(keys + ["host", "content-length"]))
            program(f"{count}-of-{length}-characters-that-differ-{where}" if count > 1 else f"one-of-{length}-characters", ONE_LENGTH_HEAD.format(keys=json.dumps(json.dumps(keys)), texts=json.dumps(json.dumps(texts))) + f"""function classify(subject: unknown, depth: number): number {{
  if (depth > 0) return classify(subject, depth - 1);
  switch (subject) {{
{cases}
    default: return 0;
  }}
}}
const answers: number[] = [];
for (const text of texts) {{
  for (const subject of kindsOf(text)) {{
    for (const key of keys) {{
      for (const room of [32, 128]) {{
        classify(headOf(key, room), 1);
        answers.push(classify(subject, 1));
      }}
    }}
  }}
}}
console.log(answers.join(""));
""")
# EVERY LENGTH FROM 1 TO 300, ten lengths a program, 1, 2, 3 or 5 texts of each length; where they differ goes round with the length.
for first in range(1, 300, 10):
    for count in (1, 2, 3, 5):
        groups = []
        for length in range(first, first + 10):
            where = ("at-the-head", "in-the-middle", "at-the-end")[length % 3]
            groups.append(textsOfOneLength(length, count, where))
        keys = [k for ks, at, base in groups for k in ks]
        byLength = [[*ks, base, ks[0][:-1] + ("?" if ks[0][-1] != "?" else "!")] for ks, at, base in groups]
        byLength = [[t for n, t in enumerate(ts) if t not in ts[:n]] for ts in byLength]
        cases = "\n".join(f"    case {json.dumps(k)}: return {i + 1};" for i, k in enumerate(keys))
        program(f"{count}-of-each-length-from-{first}-to-{first + 9}", ONE_LENGTH_HEAD.format(keys=json.dumps(json.dumps([ks for ks, at, base in groups])), texts=json.dumps(json.dumps(byLength))).replace("const keys: string[] =", "const keys: string[][] =").replace("const texts: string[] =", "const texts: string[][] =") + f"""function classify(subject: unknown, depth: number): number {{
  if (depth > 0) return classify(subject, depth - 1);
  switch (subject) {{
{cases}
    default: return 0;
  }}
}}
const answers: number[] = [];
for (let g = 0; g < texts.length; g++) {{
  for (const text of texts[g]) {{
    for (const subject of kindsOf(text)) {{
      for (const key of keys[g]) {{
        for (const room of [32, 128]) {{
          classify(headOf(key, room), 1);
          answers.push(classify(subject, 1));
        }}
      }}
    }}
  }}
}}
console.log(answers.join(","));
""")
# As it was found: twelve paths, three of 36 characters and three of 37, each asked for as a rope and as a slice of one.
paths = ["a-function-named-require-inside", "a-parameter-named-require", "a-require-declared-by-eval", "a-require-found-by-with", "a-store-through-arguments", "a-store-to-exports", "a-store-to-module", "a-store-to-require", "a-var-named-require", "exports-through-arguments", "module-exports-is-a-getter", "require-under-another-name"]
order = ["a-var-named-require", "a-store-to-require", "a-store-through-arguments", "a-parameter-named-require", "a-require-found-by-with", "a-require-declared-by-eval", "a-store-to-exports", "a-store-to-module", "exports-through-arguments", "module-exports-is-a-getter", "a-function-named-require-inside", "require-under-another-name"]
program("twelve-paths-three-of-36-and-three-of-37-characters-asked-for-as-ropes", "const names: string[] = " + json.dumps(order) + ";\nfunction pick(text: string): number {\n  switch (text) {\n" + "\n".join(f'    case "./cases/{p}.js": return {i + 1};' for i, p in enumerate(paths)) + """
    default: return 0;
  }
}
names.forEach(function (name) { console.log(name, pick("./cases/" + name + ".js"), pick(("./cases/" + name + ".js").slice(0))); });
""")
print(len(made), "programs")
