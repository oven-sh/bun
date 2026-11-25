#!/usr/bin/env python3
# generate-receivers-that-stay-as-made.py <folder>: one-shape programs: an object of one of the engine's classes is asked for what its class gives it, and comes to the operation that asks from a variable, a field,
# a call, a list or a capture. In each program somebody lays something in front of that, in one way: the deeds of generate-instances-that-stay-as-made.py. What is printed is primitive. The reference is `bun <file>`.
import os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

mine = '() => "mine"'
# name: (the class, how one is made, the arguments of its constructor, its written type, { reader: (text, key, what is laid there) })
classes = {
    "array": ("Array", "[1, 2, 3, 4]", "1, 2, 3, 4", "number[]", {
        "a-search": ("return it.indexOf(2);", '"indexOf"', mine),
        "elements-in-a-loop": ('let all = ""; for (let i = 0; i < 4; i++) all += it[i]; return all;', "1", '"laid"'),
        "pushed-and-popped": ("it.push(9); return it.pop();", '"push"', "() => 0"),
    }),
    "array-with-a-hole": ("Array", "[1, , 3, 4]", "1, 2, 3, 4", "number[]", {
        "elements-in-a-loop": ('let all = ""; for (let i = 0; i < 4; i++) all += it[i]; return all;', "1", '"laid"'),
    }),
    "map": ("Map", "new Map([[1, 2], [3, 4]])", "[[1, 2], [3, 4]]", "Map<number, number>", {
        "a-look-up": ("return it.get(1);", '"get"', mine),
    }),
    "set": ("Set", "new Set([1, 2, 3])", "[1, 2, 3]", "Set<number>", {
        "a-question": ("return it.has(1);", '"has"', mine),
    }),
    "regexp": ("RegExp", 'new RegExp("a(b)", "g")', '"a(b)", "g"', "RegExp", {
        "a-test": ('it.lastIndex = 0; return it.test("ab");', '"test"', mine),
    }),
}
# Where the operation takes its receiver from: (what is declared, with ask(), how look() puts the object there)
positions = {
    "out-of-a-variable": ("let at: any;\nfunction ask() { const it: TYPE = at; between(); ASK }", "at = it;"),
    "out-of-a-field": ("const place: { at: any } = { at: undefined };\nfunction ask() { const it: TYPE = place.at; between(); ASK }", "place.at = it;"),
    "given-by-a-call": ("let at: any;\nfunction give() { return at; }\nfunction ask() { const it: TYPE = give(); between(); ASK }", "at = it;"),
    "out-of-a-list": ("const kept: any[] = [];\nfunction ask() { const it: TYPE = kept[0]; between(); ASK }", "kept[0] = it;"),
    "out-of-a-capture": ("const reader = (() => { let at: any; return { put(it: any) { at = it; }, ask() { const it: TYPE = at; between(); ASK } }; })();\nfunction ask() { return reader.ask(); }", "reader.put(it);"),
}
# Every reader out of a variable, and these three from everywhere.
readersFromEverywhere = { ("array", "a-search"), ("array", "elements-in-a-loop"), ("map", "a-look-up") }

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


head = """// CLASS, READER, POSITION: DEED
let between = () => {};
let atEnd: () => unknown = () => "";
DECLARED
const seen: unknown[] = [];
function look(it: any) { PUT try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return MAKE; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
BODY
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
"""

count = 0
for name, (builtinClass, make, arguments, written, readers) in classes.items():
    for reader, (ask, key, value) in readers.items():
        for position, (declared, put) in positions.items():
            if position != "out-of-a-variable" and (name, reader) not in readersFromEverywhere:
                continue
            for deed, body in deeds.items():
                text = (head.replace("DECLARED", declared).replace("PUT", put).replace("BODY", body).replace("ABOVE", above).replace("ASK", ask).replace("MAKE", make).replace("ARGUMENTS", arguments).replace("KEY", key).replace("VALUE", value)
                    .replace("READER", reader.replace("-", " ")).replace("POSITION", position.replace("-", " ")).replace("DEED", deed.replace("-", " ")).replace("TYPE", written).replace("CLASS", builtinClass))
                with open(os.path.join(out, "%s-%s-%s-%s.ts" % (name, reader, position, deed)), "w") as file:
                    file.write(text)
                count += 1
print("%d programs in %s" % (count, out))
