#!/usr/bin/env python3
# generate-views-as-made.py <folder>: one-shape programs: what a typed array answers under the names that its class gives it, where the array is as its class makes it and where it is not.
# Each program holds one class, one way to read and one deed. What is printed is primitive. The reference is `bun <file>`.
import os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

classes = ["Uint8Array", "Float64Array", "Int32Array"]

readers = {
    "the-length": "return view.length;",
    "the-length-bounds-a-loop": "let total = 0; for (let i = 0; i < view.length; i++) total += view[i]; return total;",
    "the-length-is-read-twice": 'const inFront = view.length; between(); return inFront + ":" + view.length;',
    "the-bytes": 'return view.byteLength + ":" + view.byteOffset;',
    "methods": 'return view.indexOf(2) + ":" + view.at(-1) + ":" + view.join("");',
    "a-part": "return view.subarray(1).length;",
    "stepped-through": "let total = 0; for (const element of view) total += element; return total;",
    "spread": "return [...view].length;",
    "the-buffer": "return view.buffer.byteLength;",
}

# Each leaves `other`: what is looked at beside the array that is as made.
deeds = {
    "nothing-is-done": "const other: any = fresh();",
    "a-length-of-its-own": 'const other: any = fresh(); Object.defineProperty(other, "length", { value: 2, configurable: true });',
    "an-accessor-of-its-own": 'const other: any = fresh(); let reads = 0; Object.defineProperty(other, "length", { get() { reads++; return 3; }, configurable: true }); atEnd = () => reads;',
    "bytes-of-its-own": 'const other: any = fresh(); Object.defineProperty(other, "byteLength", { value: 1 }); Object.defineProperty(other, "byteOffset", { value: 9 });',
    "a-buffer-of-its-own": 'const other: any = fresh(); Object.defineProperty(other, "buffer", { value: new ArrayBuffer(3) });',
    "methods-of-its-own": 'const other: any = fresh(); other.indexOf = () => "mine"; other.at = () => "mine"; other.join = () => "mine"; other.subarray = () => [1];',
    "an-iterator-of-its-own": "const other: any = fresh(); other[Symbol.iterator] = function* () { yield 40; yield 2; };",
    "a-constructor-of-its-own": "const other: any = fresh(); other.constructor = { [Symbol.species]: function (buffer: ArrayBuffer) { return new CLASS(buffer, 0, 1); } };",
    "a-name-that-hides-nothing": "const other: any = fresh(); other.extra = 1;",
    "the-one-that-was-looked-at-gets-a-length": 'const other: any = plain; Object.defineProperty(other, "length", { value: 2, configurable: true });',
    "the-one-that-was-looked-at-gets-a-length-and-loses-it": 'const other: any = plain; Object.defineProperty(other, "length", { value: 2, configurable: true }); look(other); delete other.length;',
    "the-one-that-was-looked-at-gets-another-prototype": "const other: any = plain; Object.setPrototypeOf(other, { __proto__: CLASS.prototype, get length() { return 1; }, get byteLength() { return 5; }, join() { return \"above\"; } });",
    "another-prototype": "const other: any = fresh(); Object.setPrototypeOf(other, { __proto__: CLASS.prototype, get length() { return 1; }, get byteLength() { return 5; }, join() { return \"above\"; } });",
    "no-prototype": "const other: any = fresh(); Object.setPrototypeOf(other, null);",
    "the-prototype-of-another-class": "const other: any = fresh(); Object.setPrototypeOf(other, Array.prototype);",
    "of-a-class-below-that-answers-itself": "class Below extends CLASS { get length() { return 2; } get byteLength() { return 6; } join() { return \"below\"; } }\nconst other: any = new Below(4);",
    "of-a-class-below-that-adds-nothing": "class Below extends CLASS {}\nconst other: any = new Below(4); other[1] = 2;",
    "no-more-names-are-taken": "const other: any = fresh(); Object.preventExtensions(other);",
    "its-buffer-grows": "const grows = new ArrayBuffer(4 * CLASS.BYTES_PER_ELEMENT, { maxByteLength: 16 * CLASS.BYTES_PER_ELEMENT });\nconst other: any = new CLASS(grows); other[1] = 2; look(other); grows.resize(8 * CLASS.BYTES_PER_ELEMENT);",
    "its-buffer-shrinks": "const shrinks = new ArrayBuffer(8 * CLASS.BYTES_PER_ELEMENT, { maxByteLength: 16 * CLASS.BYTES_PER_ELEMENT });\nconst other: any = new CLASS(shrinks); other[1] = 2; look(other); shrinks.resize(2 * CLASS.BYTES_PER_ELEMENT);",
    "its-buffer-shrinks-below-its-end": "const shrinks = new ArrayBuffer(8 * CLASS.BYTES_PER_ELEMENT, { maxByteLength: 16 * CLASS.BYTES_PER_ELEMENT });\nconst other: any = new CLASS(shrinks, 0, 6); other[1] = 2; look(other); shrinks.resize(2 * CLASS.BYTES_PER_ELEMENT);",
    "its-buffer-shrinks-and-grows-again": "const moves = new ArrayBuffer(8 * CLASS.BYTES_PER_ELEMENT, { maxByteLength: 16 * CLASS.BYTES_PER_ELEMENT });\nconst other: any = new CLASS(moves, CLASS.BYTES_PER_ELEMENT, 6); other[1] = 2; moves.resize(2 * CLASS.BYTES_PER_ELEMENT); look(other); moves.resize(12 * CLASS.BYTES_PER_ELEMENT);",
    "its-buffer-is-handed-away": "const other: any = fresh(); look(other); other.buffer.transfer();",
    "the-one-that-was-looked-at-loses-its-buffer": "const other: any = plain; structuredClone(other.buffer, { transfer: [other.buffer] });",
    "it-starts-inside-its-buffer": "const other: any = new CLASS(new ArrayBuffer(8 * CLASS.BYTES_PER_ELEMENT), 2 * CLASS.BYTES_PER_ELEMENT, 3); other[1] = 2;",
    "it-is-empty": "const other: any = new CLASS(0);",
    "over-shared-memory": "const other: any = new CLASS(new SharedArrayBuffer(4 * CLASS.BYTES_PER_ELEMENT)); other[1] = 2;",
    "over-shared-memory-that-grows": "const shared = new SharedArrayBuffer(4 * CLASS.BYTES_PER_ELEMENT, { maxByteLength: 16 * CLASS.BYTES_PER_ELEMENT });\nconst other: any = new CLASS(shared); other[1] = 2; look(other); shared.grow(8 * CLASS.BYTES_PER_ELEMENT);",
    "an-object-below-one": "const other: any = Object.create(fresh());",
    "a-proxy-of-one": "const other: any = new Proxy(fresh(), {});",
    "a-list": "const other: any = [1, 2, 3];",
    "an-object-with-the-names": 'const other: any = { length: 2, byteLength: 3, byteOffset: 4, 0: 5, 1: 6, buffer: { byteLength: 7 }, indexOf() { return "i"; }, at() { return "a"; }, join() { return "j"; }, subarray() { return "ab"; }, *[Symbol.iterator]() { yield 8; } };',
    "of-another-class-of-views": "const other: any = new Int16Array([1, 2, 3, 4, 5]);",
    "undefined": "const other: any = undefined;",
    "the-deed-is-done-between-two-reads": 'const other: any = fresh(); let turns = 0; between = () => { if (++turns === 3) Object.defineProperty(other, "length", { value: 2, configurable: true }); };',
}

head = """// CLASS, READER: DEED
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: CLASS) { ASK }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new CLASS(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
BODY
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
"""

count = 0
def write(name, text):
    global count
    with open(os.path.join(out, name + ".ts"), "w") as file:
        file.write(text)
    count += 1

for view in classes:
    for reader, ask in readers.items():
        if view != "Uint8Array" and reader not in ("the-length-bounds-a-loop", "the-bytes"):
            continue
        for deed, body in deeds.items():
            text = (head.replace("BODY", body).replace("ASK", ask).replace("READER", reader.replace("-", " ")).replace("DEED", deed.replace("-", " ")).replace("CLASS", view))
            write("%s-%s-%s" % (view.lower(), reader, deed), text)

# What only Uint8Array has below it, and what comes out of another realm.
for reader, ask in readers.items():
    for deed, body in {
        "a-buffer-of-node": "const other: any = Buffer.from([1, 2, 3, 4, 5]);",
        "a-part-of-a-buffer-of-node": "const other: any = Buffer.from([1, 2, 3, 4, 5, 6]).subarray(2);",
        "a-buffer-of-node-with-a-length-of-its-own": 'const other: any = Buffer.from([1, 2, 3, 4, 5]); Object.defineProperty(other, "length", { value: 2 });',
        "out-of-another-realm": 'const other: any = (await import("node:vm")).runInNewContext("new Uint8Array([1, 2, 3])");',
        "out-of-another-realm-with-a-length-of-its-own": 'const other: any = (await import("node:vm")).runInNewContext("Object.defineProperty(new Uint8Array([1, 2, 3]), \'length\', { value: 1 })");',
    }.items():
        text = (head.replace("BODY", body).replace("ASK", ask).replace("READER", reader.replace("-", " ")).replace("DEED", deed.replace("-", " ")).replace("CLASS", "Uint8Array"))
        write("uint8array-%s-%s" % (reader, deed), text)

print("%d programs in %s" % (count, out))
