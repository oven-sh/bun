#!/usr/bin/env python3
# generate-records-that-share-their-member-types-written-as-json.py <folder>: 19 of the 21 programs of test/aot/parallel/records-that-share-their-member-types-written-as-json, each held to `bun <file>`. The two eight-levels-*-as-the-runner-had-them.ts are by hand.
# A lattice of record types: six members a level, each level with names of its own, every member of the next level's type. JSON.stringify() is handed a list of such records, or a record with such a list.
# Whoever asks a question of all that such a type reaches has to ask each layout once: asked once for each member that names it, thirty levels are 6^30 visits, and the build of a program never ends. No time is printed: a build that does not end is what shows.
# The types are deep; the values that are written are thin (one record a level), so the texts stay short. A new kin: one more line `programs[name] = [..]`.
import os, sys
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
NAMES = "abcdef"
SUM = "function sum(text: string): number { let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return h; }"
FEW = "function few(n: number): boolean { let t = 0; for (let i = 0; i < (n & 3); i++) t += i; return t > 99; }"
PRINT = ["console.log(out.length, sum(out));", "console.log(out.slice(0, 240));"]


def erase(lines):
    import re
    text = "\n".join(l for l in lines if not l.startswith("type "))
    text = re.sub(r"^const (\w+): [^=]+ = ", r"const \1 = ", text, flags=re.M)
    text = re.sub(r"\((\w+): [\w\[\] |{};:]+?, (\w+): [\w\[\] |]+\): \w+", r"(\1, \2)", text)
    text = re.sub(r"\((\w+): [\w\[\] |]+\): [\w\[\] |]+ \{", r"(\1) {", text)
    text = re.sub(r"\(\): void", "()", text)
    return text.split("\n")


def leaf(T, d):
    return f"type {T}{d} = {{ " + " ".join(f"{n}{d}: number;" for n in NAMES) + " };"


def leafValue(v, T, d, order=NAMES):
    return f"const {v}{d}: {T}{d} = {{ " + ", ".join(f"{n}{d}: {NAMES.index(n) + 1}" for n in order) + " };"


# every member holds a record: the value is as wide as the type, so only its lowest levels are ever written
def full(d, order=NAMES):
    lines = [leaf("L", d)] + [f"type L{k} = {{ " + " ".join(f"{n}{k}: L{k + 1};" for n in NAMES) + " };" for k in range(d - 1, -1, -1)]
    lines += [leafValue("v", "L", d, order)] + [f"const v{k}: L{k} = {{ " + ", ".join(f"{n}{k}: v{k + 1}" for n in order) + " };" for k in range(d - 1, -1, -1)]
    return lines


# `wrap` makes the written type of a member out of the next level's name, `some` and `none` its values. full<k> fills every member, thin<k> one member a level.
def thin(d, wrap, some, none, optional=False):
    mark = "?" if optional else ""
    lines = [leaf("L", d)] + [f"type L{k} = {{ " + " ".join(f"{n}{k}{mark}: {wrap(f'L{k + 1}')};" for n in NAMES) + " };" for k in range(d - 1, -1, -1)]
    lines += [leafValue("full", "L", d), leafValue("thin", "L", d)]
    for k in range(d - 1, -1, -1):
        lines.append(f"const full{k}: L{k} = {{ " + ", ".join(f"{n}{k}: {some(f'full{k + 1}')}" for n in NAMES) + " };")
        kept = NAMES[k % 6]
        members = [f"{n}{k}: {some(f'thin{k + 1}') if n == kept else none}" for n in NAMES if n == kept or none is not None]
        lines.append(f"const thin{k}: L{k} = {{ " + ", ".join(members) + " };")
    return lines


def listSite(T="L0", turns=300, wide="v0", rows="[]", through="", behind='" " + status'):
    send = f"send(i, {through}(make(i)))" if through else "send(i, make(i))"
    return ['let out = "";', SUM, FEW, f"function make(n: number): {T}[] {{ return few(n) ? [{wide}] : {rows}; }}",
            f'function send(status: number, value: {T}[]): void {{ out += JSON.stringify(value) + {behind} + "\\n"; }}',
            f"function shape(): void {{ for (let i = 0; i < {turns}; i++) {send}; }}", "shape(); shape();"]


def low(d):
    return [f"function makeLow(n: number): L{d - 2}[] {{ return n & 1 ? [v{d - 2}] : [v{d - 2}, v{d - 2}]; }}",
            f'function sendLow(status: number, value: L{d - 2}[]): void {{ out += JSON.stringify(value) + " " + status + "\\n"; }}',
            "function shapeLow(): void { for (let i = 0; i < 6; i++) sendLow(i, makeLow(i)); }", "shapeLow(); shapeLow();"]


def boxSite(T="L0", wide="v0", rows="[]", through=""):
    send = f"send(i, {through}(make(i)))" if through else "send(i, make(i))"
    return ['let out = "";', SUM, FEW, f"type Box = {{ ok: boolean; rows: {T}[] }};", f"function make(n: number): Box {{ return {{ ok: (n & 1) === 0, rows: few(n) ? [{wide}] : {rows} }}; }}",
            'function send(status: number, value: Box): void { out += JSON.stringify(value) + " " + status + "\\n"; }', f"function shape(): void {{ for (let i = 0; i < 300; i++) {send}; }}", "shape(); shape();"]


orNull = dict(wrap=lambda T: f"{T} | null", some=lambda v: v, none="null")
THIN = "(n & 1 ? [thin0] : [thin0, thin0])"
programs = {}
programs["twelve-levels.ts"] = ["// a list of records, twelve levels of types below it; the two lowest levels are written whole"] + full(12) + listSite() + low(12) + PRINT
programs["thirty-levels.ts"] = ["// a list of records, thirty levels of types below it; the two lowest levels are written whole"] + full(30) + listSite() + low(30) + PRINT
programs["thirty-levels-and-a-number-is-added-first.ts"] = ["// a number is added to what the call gives, so no join of texts takes the text of the list"] + full(30) + listSite(behind="status") + low(30) + PRINT
programs["thirty-levels-in-a-box.ts"] = ["// a record with a list member, thirty levels of types below it"] + full(30) + boxSite() + low(30) + PRINT
programs["thirty-levels-keys-in-another-order.ts"] = ["// the records are made with their keys in another order than their types list them"] + full(30, "fbdace") + boxSite() + low(30) + PRINT
programs["thirty-levels-members-or-null.ts"] = ["// each member holds a record or null: the rows that are written hold one record a level"] + thin(30, **orNull) + listSite(wide="full0", rows=THIN) + PRINT
programs["thirty-levels-members-or-null-in-a-box.ts"] = ["// each member holds a record or null, and the list lies in a record"] + thin(30, **orNull) + boxSite(wide="full0", rows=THIN) + PRINT
programs["thirty-levels-untyped.js"] = ["// nothing is written of any type: what arrives at the fields is all that anybody knows"] + erase(thin(30, **orNull) + listSite(wide="full0", rows=THIN) + PRINT)
programs["thirty-levels-optional-members.ts"] = ["// each member may be left out: the rows that are written have one member a level"] + thin(30, wrap=lambda T: T, some=lambda v: v, none=None, optional=True) + boxSite(wide="full0", rows=THIN) + PRINT
programs["thirty-levels-lists-at-every-level.ts"] = ["// each member is a list of records of the next level: the rows that are written hold one record a level"] + thin(30, wrap=lambda T: f"{T}[]", some=lambda v: f"[{v}]", none="[]") + boxSite(wide="full0", rows=THIN) + PRINT
programs["thirty-levels-one-level-deeper.ts"] = ["// the list lies in a record in a record"] + thin(30, **orNull) + ['let out = "";', SUM, FEW, "type Page = { at: number; body: { rows: L0[]; more: L0[] } };",
    f"function make(n: number): Page {{ return {{ at: n, body: {{ rows: few(n) ? [full0] : {THIN}, more: [] }} }}; }}", 'function send(status: number, value: Page): void { out += JSON.stringify(value) + " " + status + "\\n"; }',
    "function shape(): void { for (let i = 0; i < 300; i++) send(i, make(i)); }", "shape(); shape();"] + PRINT
programs["thirty-levels-rows-through-unseen-code.ts"] = ["// the rows go through code that nobody has seen, which hands them back"] + thin(30, **orNull) + ['const pass = (0, eval)("(x) => x") as <T>(box: T) => T;'] + boxSite(wide="full0", rows=THIN, through="pass") + PRINT
programs["thirty-levels-a-row-changed-by-unseen-code.ts"] = ["// code that nobody has seen lays a number where a record is written, and a toJSON on a record further down"] + thin(30, **orNull) + [
    'const spoil = (0, eval)("(box) => { const row = box.rows[0]; if (box.ok && row.a0 && !row.a0.toJSON && box.rows.length > 1) { row.f0 = 7; row.a0.toJSON = () => \'spoiled\'; } return box; }") as <T>(box: T) => T;'] + boxSite(wide="full0", rows=THIN, through="spoil") + PRINT

# two layouts a level, three members each, every member a union of both
def unions(d):
    P, Q = "abc", "uvw"
    lines = [f"type P{d} = {{ " + " ".join(f"{n}{d}: number;" for n in P) + " };", f"type Q{d} = {{ " + " ".join(f"{n}{d}: string;" for n in Q) + " };"]
    for k in range(d - 1, -1, -1):
        for T, names in (("P", P), ("Q", Q)):
            lines.append(f"type {T}{k} = {{ " + " ".join(f"{n}{k}: P{k + 1} | Q{k + 1} | null;" for n in names) + " };")
    lines += [f"const fullP{d}: P{d} = {{ a{d}: 1, b{d}: 2, c{d}: 3 }};", f'const fullQ{d}: Q{d} = {{ u{d}: "u", v{d}: "v", w{d}: "w" }};', f"const thinP{d}: P{d} = fullP{d};", f"const thinQ{d}: Q{d} = fullQ{d};"]
    for k in range(d - 1, -1, -1):
        for T, names in (("P", P), ("Q", Q)):
            lines.append(f"const full{T}{k}: {T}{k} = {{ " + ", ".join(f"{n}{k}: full{'PQ'[i & 1]}{k + 1}" for i, n in enumerate(names)) + " };")
            lines.append(f"const also{T}{k}: {T}{k} = {{ " + ", ".join(f"{n}{k}: full{'QP'[i & 1]}{k + 1}" for i, n in enumerate(names)) + " };")
            kept = names[k % 3]
            lines.append(f"const thin{T}{k}: {T}{k} = {{ " + ", ".join(f"{n}{k}: " + (f"thin{'Q' if T == 'P' else 'P'}{k + 1}" if n == kept else "null") for n in names) + " };")
    return lines


programs["thirty-levels-unions-among-the-members.ts"] = ["// two types a level, and each member holds a record of either or null"] + unions(30) + ['let out = "";', SUM, FEW,
    "type Box = { ok: boolean; rows: (P0 | Q0)[] };", "function make(n: number): Box { return { ok: true, rows: few(n) ? [fullP0, alsoP0, fullQ0, alsoQ0] : n & 1 ? [thinP0] : [thinQ0, thinP0] }; }", 'function send(status: number, value: Box): void { out += JSON.stringify(value) + " " + status + "\\n"; }',
    "function shape(): void { for (let i = 0; i < 300; i++) send(i, make(i)); }", "shape(); shape();"] + PRINT

programs["ring-of-types.ts"] = """// a row holds lists of rows and pairs of rows, which hold rows: every road through the types leads back
type Row = { id: number; left: Row[]; right: Row[]; pair: Pair | null; twin: Pair | null };
type Pair = { one: Row; two: Row; rows: Row[]; more: Row[] };
let out = "";
SUM
function row(id: number, left: Row[], right: Row[], pair: Pair | null, twin: Pair | null): Row { return { id, left, right, pair, twin }; }
function pairOf(one: Row, two: Row): Pair { return { one, two, rows: [one], more: [] }; }
type Shelf = { name: string; rows: Row[] };
function make(n: number): Shelf { const low = row(n, [], [], null, null); const mid = row(n + 1, [low], [low, low], pairOf(low, low), null); return { name: "s" + n, rows: [row(n + 2, [mid], [], null, pairOf(mid, low)), low] }; }
function send(status: number, value: Shelf): void { out += JSON.stringify(value) + " " + status + "\\n"; }
function shape(): void { for (let i = 0; i < 300; i++) send(i, make(i)); }
shape(); shape();
console.log(out.length, sum(out));
console.log(out.slice(0, 240));""".replace("SUM", SUM).split("\n")

programs["ring-of-types-and-a-row-that-holds-itself.ts"] = """// a row holds lists of rows; at the three hundredth call one of them holds itself, and the host's error is caught
type Row = { id: number; left: Row[]; right: Row[]; next: Row | null; last: Row | null };
let out = "";
SUM
type Shelf = { name: string; rows: Row[] };
function make(n: number): Shelf { const low: Row = { id: n, left: [], right: [], next: null, last: null }; const top: Row = { id: n + 1, left: [low], right: [low], next: low, last: low }; if (n === 299) low.left.push(top); return { name: "s" + n, rows: [top] }; }
function send(status: number, value: Shelf): void { try { out += JSON.stringify(value) + " " + status + "\\n"; } catch (e) { out += (e as Error).constructor.name + status + "\\n"; } }
function shape(): void { for (let i = 0; i < 300; i++) send(i, make(i)); }
shape(); shape();
console.log(out.length, sum(out));
console.log(out.slice(-120));""".replace("SUM", SUM).split("\n")

# the whole text of a small lattice: the writer by type must still fire, and what it writes is held against plain
programs["three-levels-written-whole.ts"] = ["// three levels, written whole at every call"] + full(3) + listSite(wide="v0", rows="(n & 1 ? [v0] : [v0, v0])", turns=40) + PRINT
programs["three-levels-written-whole-in-a-box.ts"] = ["// three levels in a record with a list member, written whole at every call"] + full(3) + boxSite(wide="v0", rows="(n & 1 ? [v0] : [v0, v0])") + PRINT

# the answer is no: at the bottom of the lattice one slot proves no plan
def spoiledLeaf(d):
    lines = thin(d, **orNull)
    lines[0] = f"type L{d} = {{ " + " ".join(f"{n}{d}: number;" for n in NAMES[:5]) + f" f{d}: unknown; }};"
    at = [i for i, l in enumerate(lines) if l.startswith(f"const full{d}:")][0]
    lines[at] = f"const full{d}: L{d} = {{ " + ", ".join(f"{n}{d}: {i + 1}" for i, n in enumerate(NAMES[:5])) + f', f{d}: JSON.parse("[1, {{}}]") }};'
    lines[at + 1] = f"const thin{d}: L{d} = {{ " + ", ".join(f"{n}{d}: {i + 1}" for i, n in enumerate(NAMES[:5])) + f', f{d}: JSON.parse("{{\\"deep\\": [null]}}") }};'
    return lines


programs["thirty-levels-and-a-member-that-nobody-knows-at-the-bottom.ts"] = ["// at the lowest level one member holds what a text was parsed to: nothing proves a plan for it"] + spoiledLeaf(30) + boxSite(wide="full0", rows=THIN) + PRINT

for name, lines in programs.items():
    open(os.path.join(out, name), "w").write("\n".join(lines) + "\n")
print(len(programs), "programs in", out)
