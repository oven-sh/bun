#!/usr/bin/env python3
# generate-what-one-arm-has-proven-is-not-looked-back-at.py <folder>: all 318; ../parallel/what-one-arm-has-proven-is-not-looked-back-at/ holds 0 of them: one-shape programs: a member is read off what one arm of a test has proven, and called behind the place where the arms meet; the last call takes the other arm.
import sys, os
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
regimes = {"open": 'const unseen = (0, eval)("(x) => x");', "closed": 'const unseen = (x) => [x][JSON.parse("0")];'}
typed_regimes = {"open": 'const unseen = (0, eval)("(x) => x");', "closed": 'const unseen = <T,>(x: T): T => [x][JSON.parse("0")];'}
members = [
 ("Math", "floor", "() => -1", "f(2.5) + f(3.5)"), ("Math", "abs", '() => "fake"', "f(-2)"), ("Math", "max", "() => 0", "f(1, 2)"), ("Math", "min", "() => 9", "f(1, 2)"),
 ("Math", "sqrt", "() => -4", "f(16)"), ("Math", "round", "() => -1", "f(2.5)"), ("Math", "trunc", "() => -1", "f(2.5)"), ("Math", "ceil", "() => -1", "f(2.5)"),
 ("Math", "imul", "() => -1", "f(3, 4)"), ("Math", "pow", "() => -1", "f(2, 3)"), ("Math", "sign", "() => 7", "f(-3)"), ("Math", "hypot", "() => -1", "f(3, 4)"),
 ("String", "fromCharCode", '() => "?"', "f(65) + f(66)"), ("String", "raw", '() => "?"', "f({ raw: ['a', 'b'] }, 1)"),
 ("Number", "isInteger", '() => "no"', "f(3)"), ("Number", "parseFloat", "() => -1", 'f("2.5")'), ("Number", "isFinite", '() => "no"', "f(3)"), ("Number", "isNaN", '() => "no"', "f(NaN)"),
 ("Number", "isSafeInteger", '() => "no"', "f(3)"), ("Number", "parseInt", "() => -1", 'f("25")'),
 ("Object", "keys", '() => ["fake"]', "f({ a: 1 }).join()"), ("Object", "values", '() => ["fake"]', "f({ a: 1 }).join()"), ("Object", "entries", '() => ["fake"]', "f({ a: 1 }).join()"),
 ("Object", "is", '() => "fake"', "f(1, 1)"), ("Object", "isFrozen", '() => "fake"', "f({})"), ("Object", "getPrototypeOf", '() => "fake"', "f([]) === Array.prototype"),
 ("Array", "isArray", '() => "fake"', "f([])"), ("Array", "of", '() => ["fake"]', "f(1, 2).join()"), ("Array", "from", '() => ["fake"]', 'f("ab").join()'),
 ("JSON", "stringify", '() => "fake"', "f({ a: 1 })"), ("JSON", "parse", '() => "fake"', 'String(f("[1]"))'),
 ("Reflect", "has", '() => "fake"', 'f({ a: 1 }, "a")'), ("Reflect", "ownKeys", '() => ["fake"]', "f({ a: 1 }).join()"),
]
betweens = {"a-call": "noise();", "nothing": "", "a-test": 'if (i < 0) return "never";', "a-loop": "let k = 0; for (let j = 0; j < 2; j++) k += j; if (k !== 1) return k;"}
count = 0
def write(name, text):
    global count
    open(os.path.join(out, name), "w").write(text); count += 1
def by_list(regime, ns, member, fake, use, between, typed):
    t = typed
    return f"""{(typed_regimes if t else regimes)[regime]}
class Kit {{ ns = {ns}; }}
const kits{': Kit[]' if t else ''} = [new Kit(), new Kit(), new Kit()];
kits.push(unseen({{ ns: {{ {member}: {fake} }} }}{' as any' if t else ''}));
function noise(){': number' if t else ''} {{ return unseen(0); }}
function read(i{': number' if t else ''}){': unknown' if t else ''} {{
  const kit = kits[i];
  const f = kit.ns.{member}{' as any' if t else ''};
  {between}
  return {use};
}}
const run = unseen(read);
let last{': unknown' if t else ''};
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
"""
def by_parameter(regime, ns, member, fake, use, between):
    return f"""{typed_regimes[regime]}
class Kit {{ ns = {ns}; }}
function noise(): number {{ return unseen(0); }}
function read(kit: Kit, i: number): unknown {{
  const f = kit.ns.{member} as any;
  {between}
  return {use};
}}
const run = unseen(read);
const one = new Kit();
let last: unknown;
for (let r = 0; r < 300; r++) last = run(one, r);
console.log(String(last), String(run(unseen({{ ns: {{ {member}: {fake} }} }} as any), 1)));
"""
def by_record(regime, ns, member, fake, use, between):
    return f"""{typed_regimes[regime]}
type Kit = {{ ns: typeof {ns} }};
const kits: Kit[] = [{{ ns: {ns} }}, {{ ns: {ns} }}, {{ ns: {ns} }}];
kits.push(unseen({{ ns: {{ {member}: {fake} }} }} as any));
function noise(): number {{ return unseen(0); }}
function read(i: number): unknown {{
  const kit = kits[i];
  const f = kit.ns.{member} as any;
  {between}
  return {use};
}}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
"""
def by_union_call(regime, ns, member, fake, use, between):
    return f"""{typed_regimes[regime]}
class Real {{ ns = {ns}; get(): any {{ return this.ns; }} }}
class Fake {{ ns = {{ {member}: {fake} }}; get(): any {{ return this.ns; }} }}
function noise(): number {{ return unseen(0); }}
function read(kit: Real | Fake, i: number): unknown {{
  const f = kit.get().{member};
  {between}
  return {use};
}}
const run = unseen(read);
const real = new Real(), fake = new Fake();
let last: unknown, other: unknown;
for (let r = 0; r < 300; r++) {{ last = run(real, r); if (r % 50 === 49) other = run(fake, r); }}
console.log(String(last), String(other), String(run(fake, 1)), String(run(real, 1)));
"""
for regime in regimes:
    for ns, member, fake, use in members:
        write(f"{ns.lower()}-{member.lower()}-off-a-list-of-a-class-{regime}.ts", by_list(regime, ns, member, fake, use, betweens["a-call"], True))
    for ns, member, fake, use in [members[0], members[2], members[12], members[20], members[26], members[29]]:
        for label, between in betweens.items():
            stem = f"{ns.lower()}-{member.lower()}-behind-{label}-{regime}"
            write(f"{stem}-untyped.js", by_list(regime, ns, member, fake, use, between, False))
            write(f"{stem}-a-parameter.ts", by_parameter(regime, ns, member, fake, use, between))
            write(f"{stem}-a-record.ts", by_record(regime, ns, member, fake, use, between))
            write(f"{stem}-a-call-on-a-union.ts", by_union_call(regime, ns, member, fake, use, between))
            if label != "a-call":
                write(f"{stem}-a-list.ts", by_list(regime, ns, member, fake, use, between, True))
    # Members found above an instance: the object of the read is an instance in one arm and something else in the other.
    for holder, made, member, fake, use in [("list", "[3, 1, 2]", "join", '() => "fake"', "f.call(kit.held)"), ("list", "[3, 1, 2]", "indexOf", "() => -7", "f.call(kit.held, 1)"),
                                            ("text", '"abc"', "charCodeAt", "() => -7", "f.call(kit.held, 1)"), ("text", '"abc"', "toUpperCase", '() => "fake"', "f.call(kit.held)"),
                                            ("map", "new Map([[1, 2]])", "get", "() => -7", "f.call(kit.held, 1)"), ("set", "new Set([1])", "has", '() => "fake"', "f.call(kit.held, 1)")]:
        write(f"{member.lower()}-of-a-{holder}-held-by-a-class-{regime}.ts", f"""{typed_regimes[regime]}
class Kit {{ held = {made}; }}
const kits: Kit[] = [new Kit(), new Kit(), new Kit()];
kits.push(unseen({{ held: {{ {member}: {fake} }} }} as any));
function noise(): number {{ return unseen(0); }}
function read(i: number): unknown {{
  const kit = kits[i];
  const f = kit.held.{member} as any;
  noise();
  return {use};
}}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
""")
    # Arms of numbers: what the stretch makes of a number is an int32 in one arm and a double in the other, and is read through a later value alone.
    for label, body in [("a-sum", "const t = a + 1; const u = t * 2; noise(); return u + 0.5;"), ("a-quotient", "const t = a / 2; const u = t + 1; noise(); return Math.floor(u);"),
                        ("a-text", "const t = a + 1; const u = String(t); noise(); return u + u.length;"), ("a-key", "const t = a + 1; const u = [10, 20, 30, 40][t]; noise(); return u;"),
                        ("a-relation", "const t = a * 2; const u = t < 5; noise(); return u ? 1 : 2;"), ("bits", "const t = a + 0.5; const u = t | 0; noise(); return u;")]:
        write(f"numbers-{label}-{regime}.ts", f"""{typed_regimes[regime]}
function noise(): number {{ return unseen(0); }}
function read(a: number): unknown {{
  {body}
}}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(1.5)), String(run(NaN)), String(run(-0)), String(run(2147483647)), String(run(unseen("1") as any)));
""")
print(count, "programs")
