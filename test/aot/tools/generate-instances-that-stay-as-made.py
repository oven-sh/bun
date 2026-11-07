#!/usr/bin/env python3
# generate-instances-that-stay-as-made.py <folder>: all 851; ../parallel/instances-that-stay-as-made/ holds 8 of them: one-shape programs: an object of one of the engine's classes arrives at a parameter whose callers are all in sight, and is asked for what its class gives it.
# In each program somebody lays something in front of that, in one way. What is printed is primitive. The reference is `bun <file>`.
import os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

mine = '() => "mine"'
# class: (how one is made, the arguments of its constructor, { reader: (text, key, what is laid there) })
classes = {
    "Uint8Array": ("new Uint8Array([1, 2, 3, 4])", "[1, 2, 3, 4]", {
        "the-length": ("return it.length;", '"length"', "7"),
        "the-length-bounds-a-loop": ("let total = 0; for (let i = 0; i < it.length; i++) total += it[i]; return total;", '"length"', "2"),
        "the-bytes": ("return it.byteLength;", '"byteLength"', "7"),
        "a-method": ("return it.indexOf(2);", '"indexOf"', mine),
        "spread": ("return [...it].length;", "Symbol.iterator", "function* () { yield 42; }"),
    }),
    "Array": ("[1, 2, 3, 4]", "1, 2, 3, 4", {
        "a-search": ("return it.indexOf(2);", '"indexOf"', mine),
        "joined": ('return it.join("");', '"join"', mine),
        "mapped": ("return it.map((x: number) => x + 1).length;", '"map"', "() => [1]"),
        "the-last": ("return it.at(-1);", '"at"', mine),
        "spread": ("return [...it].length;", "Symbol.iterator", "function* () { yield 42; }"),
        "a-copy-by-its-kind": ("return it.slice(1) instanceof Array;", '"constructor"', "{ [Symbol.species]: function () { return { length: 0 }; } }"),
        "laid-end-to-end": ("return [0].concat(it).length;", "Symbol.isConcatSpreadable", "false"),
    }),
    "Map": ("new Map([[1, 2], [3, 4]])", "[[1, 2], [3, 4]]", {
        "the-size": ("return it.size;", '"size"', "7"),
        "a-look-up": ("return it.get(1);", '"get"', mine),
        "a-question": ("return it.has(1);", '"has"', mine),
        "spread": ("return [...it].length;", "Symbol.iterator", "function* () { yield 42; }"),
    }),
    "Set": ("new Set([1, 2, 3])", "[1, 2, 3]", {
        "the-size": ("return it.size;", '"size"', "7"),
        "a-question": ("return it.has(1);", '"has"', mine),
        "spread": ("return [...it].length;", "Symbol.iterator", "function* () { yield 42; }"),
    }),
    "RegExp": ("new RegExp(\"a(b)\", \"g\")", '"a(b)", "g"', {
        "the-source": ("return it.source;", '"source"', '"laid"'),
        "the-flags": ("return it.flags;", '"flags"', '"y"'),
        "a-test": ('it.lastIndex = 0; return it.test("ab");', '"test"', mine),
        "a-replacement": ('it.lastIndex = 0; return "abab".replace(it, "x");', '"exec"', "() => null"),
    }),
}

above = "{ __proto__: CLASS.prototype, [KEY]: VALUE }"
deeds = {
    "nothing-is-done": "const other: any = make();",
    "stored-under-the-key": "const other: any = make(); try { other[KEY] = VALUE; } catch {}",
    "stored-under-a-key-nobody-knows": "const other: any = make(); const k: any = process.env.NO_SUCH_VARIABLE_OF_THIS_TEST ?? KEY; try { other[k] = VALUE; } catch {}",
    "defined": "const other: any = make(); Object.defineProperty(other, KEY, { value: VALUE, configurable: true });",
    "defined-under-a-key-nobody-knows": "const other: any = make(); const k: any = process.env.NO_SUCH_VARIABLE_OF_THIS_TEST ?? KEY; Object.defineProperty(other, k, { value: VALUE, configurable: true });",
    "an-accessor-is-laid": "const other: any = make(); let reads = 0; Object.defineProperty(other, KEY, { get() { reads++; return VALUE; }, configurable: true }); atEnd = () => reads > 0;",
    "defined-among-several": "const other: any = make(); Object.defineProperties(other, { [KEY]: { value: VALUE, configurable: true } });",
    "by-reflect-define": "const other: any = make(); Reflect.defineProperty(other, KEY, { value: VALUE, configurable: true });",
    "by-assign": "const other: any = make(); try { Object.assign(other, { [KEY]: VALUE }); } catch {}",
    "by-the-old-way-to-lay-a-getter": "const other: any = make(); other.__defineGetter__(KEY, () => (VALUE));",
    "another-prototype": "const other: any = make(); Object.setPrototypeOf(other, ABOVE);",
    "another-prototype-by-reflect": "const other: any = make(); Reflect.setPrototypeOf(other, ABOVE);",
    "another-prototype-by-the-old-name": "const other: any = make(); other.__proto__ = ABOVE;",
    "no-prototype": "const other: any = make(); Object.setPrototypeOf(other, null);",
    "of-a-class-below-that-answers-itself": "class Below extends CLASS {}\nObject.defineProperty(Below.prototype, KEY, { value: VALUE, configurable: true });\nconst other: any = new Below(ARGUMENTS);",
    "of-a-class-below-that-adds-nothing": "class Below extends CLASS {}\nconst other: any = new Below(ARGUMENTS);",
    "constructed-for-another": "function Other() {}\nOther.prototype = ABOVE;\nconst other: any = Reflect.construct(CLASS, [ARGUMENTS], Other);",
    "stamped-by-a-field-of-a-class": "class Handed { constructor(it: object) { return it; } }\nclass Stamps extends Handed { [KEY] = VALUE; }\nconst other: any = make(); new Stamps(other);",
    "through-a-proxy": "const other: any = make(); Object.defineProperty(new Proxy(other, {}), KEY, { value: VALUE, configurable: true });",
    "through-a-field": "const other: any = make(); const holder: { it: any } = { it: other }; try { holder.it[KEY] = VALUE; } catch {}",
    "through-a-list": "const other: any = make(); const held: any[] = [other]; try { held[0][KEY] = VALUE; } catch {}",
    "through-a-table": "const other: any = make(); const held = new Map<string, any>([[\"it\", other]]); try { held.get(\"it\")[KEY] = VALUE; } catch {}",
    "through-a-weak-reference": "const other: any = make(); try { new WeakRef<any>(other).deref()[KEY] = VALUE; } catch {}",
    "by-a-closure": "const other: any = make(); const deed = () => { try { other[KEY] = VALUE; } catch {} }; deed();",
    "by-a-callee": "function deed(o: any) { try { o[KEY] = VALUE; } catch {} }\nconst other: any = make(); deed(other);",
    "by-a-callee-that-defines": "function deed(o: any, k: any) { Object.defineProperty(o, k, { value: VALUE, configurable: true }); }\nconst other: any = make(); deed(other, KEY);",
    "by-code-out-of-sight": "const other: any = make(); (globalThis as any).deeds = [(o: any) => { try { o[KEY] = VALUE; } catch {} }]; (globalThis as any).deeds[0](other);",
    "by-the-callback-of-a-built-in": "const other: any = make(); [other].forEach((o: any) => { try { o[KEY] = VALUE; } catch {} });",
    "as-the-receiver-of-a-call": "function deed(this: any) { try { this[KEY] = VALUE; } catch {} }\nconst other: any = make(); deed.call(other);",
    "as-the-receiver-of-a-bound-function": "function deed(this: any) { try { this[KEY] = VALUE; } catch {} }\nconst other: any = make(); deed.bind(other)();",
    "behind-an-await": "const other: any = make(); look(other); await null; try { other[KEY] = VALUE; } catch {}",
    "the-one-that-was-looked-at": "const other: any = plain; try { other[KEY] = VALUE; } catch {}",
    "the-one-that-was-looked-at-and-taken-away-again": "const other: any = plain; Object.defineProperty(other, KEY, { value: VALUE, configurable: true }); look(other); delete other[KEY];",
    "between-two-looks-by-a-callee-of-the-reader": "const other: any = make(); let turns = 0; between = () => { if (++turns === 3) Object.defineProperty(other, KEY, { value: VALUE, configurable: true }); };",
    "a-copy-made-by-the-host": "const other: any = structuredClone(make()); try { other[KEY] = VALUE; } catch {}",
    "a-name-that-hides-nothing": "const other: any = make(); other.extraOfThisTest = 1;",
    "frozen": "const other: any = make(); try { Object.freeze(other); } catch {}",
}

head = """// CLASS, READER: DEED
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: TYPE) { between(); ASK }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return MAKE; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
BODY
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
"""

types = { "Uint8Array": "Uint8Array", "Array": "number[]", "Map": "Map<number, number>", "Set": "Set<number>", "RegExp": "RegExp" }
count = 0
for name, (make, arguments, readers) in classes.items():
    for reader, (ask, key, value) in readers.items():
        for deed, body in deeds.items():
            text = (head.replace("BODY", body).replace("ABOVE", above).replace("ASK", ask).replace("MAKE", make).replace("ARGUMENTS", arguments).replace("KEY", key).replace("VALUE", value)
                .replace("READER", reader.replace("-", " ")).replace("DEED", deed.replace("-", " ")).replace("TYPE", types[name]).replace("CLASS", name))
            with open(os.path.join(out, "%s-%s-%s.ts" % (name.lower(), reader, deed)), "w") as file:
                file.write(text)
            count += 1
print("%d programs in %s" % (count, out))
