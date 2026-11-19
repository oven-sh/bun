#!/usr/bin/env python3
# generate-reads-expected-by-what-was-seen.py <folder>: one-shape programs: a list of which nothing is written leaves the program; the program was seen to put one kind of thing into it,
# and code that the compiler does not see (eval) puts in something else, in front of the loop that reads it or in the middle of it. What was seen is a guess: each program prints what plain Bun prints.
import os, sys

folder = sys.argv[1]
os.makedirs(folder, exist_ok=True)

ways_in = {
    "pushed": "for (let i = 0; i < 8; i++) items.push({ price: i + 1, count: i & 3 });",
    "stored-by-index": "for (let i = 0; i < 8; i++) items[i] = { price: i + 1, count: i & 3 };",
    "unshifted": "for (let i = 0; i < 8; i++) items.unshift({ price: i + 1, count: i & 3 });",
    "spliced-in": "for (let i = 0; i < 8; i++) items.splice(i, 0, { price: i + 1, count: i & 3 });",
    "of-a-class": "class Item { constructor(i) { this.price = i + 1; this.count = i & 3; } }\nfor (let i = 0; i < 8; i++) items.push(new Item(i));",
}

changes = {
    "nothing": "0",
    "another-shape": "kept[3] = { count: 2, extra: 1, price: 5 }",
    "a-number": "kept[3] = 7",
    "a-text": "kept[3] = 'text'",
    "null": "kept[3] = null",
    "a-hole": "delete kept[3]",
    "a-getter-on-the-field": "kept[3] = { get price() { return 11; }, count: 2 }",
    "a-proxy": "kept[3] = new Proxy({ price: 1, count: 1 }, { get(target, key) { return key === 'price' ? 13 : target[key]; } })",
    "a-shorter-list": "kept.length = 2",
    "a-longer-list": "kept.push({ price: 'p', count: 2 }, 4, { count: 1 })",
    "the-field-is-deleted": "delete kept[3].price",
    "a-text-in-the-field": "kept[3].price = 'text'",
    "a-fraction-in-the-field": "kept[3].price = 0.5",
    "minus-zero-in-the-field": "kept[3].price = -0",
    "a-bigint-in-the-fields": "kept[3].price = 3n; kept[3].count = 2n",
    "a-field-is-added": "kept[3].extra = 1; kept[4].other = 2",
    "the-prototype-has-the-field": "delete kept[3].price; Object.setPrototypeOf(kept[3], { get price() { return 17; } })",
    "a-getter-on-the-index": "Object.defineProperty(kept, 3, { get() { return { price: 100, count: 1 }; } })",
    "an-index-above-the-list": "delete kept[3]; Object.setPrototypeOf(kept, Object.create(Array.prototype, { 3: { value: { price: 19, count: 1 } } }))",
    "frozen": "Object.freeze(kept); Object.freeze(kept[3])",
}

reads = {
    "at-the-top": """let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    MIDDLE
    total += items[i].price * items[i].count;
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));""",
    "in-a-function": """function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    MIDDLE
    total += list[i].price * list[i].count;
  }
  return total;
}
try { const total = sum(items); console.log(typeof total, String(total)); } catch (error) { console.log(error.constructor.name, error.message.length > 0); }""",
    "by-an-optional-chain": """const seen = [];
try {
  for (let i = 0; i < items.length; i++) {
    MIDDLE
    seen.push(String(items[i]?.price), typeof items[i]?.count);
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(seen.join(" "));""",
}

others = {
    "numbers": ("for (let i = 0; i < 8; i++) items.push(i + 1);", "total += items[i] * 2;", ["0", "kept[3] = 'text'", "kept[3] = 0.5", "kept[3] = -0", "kept[3] = { valueOf() { return 5; } }", "delete kept[3]", "kept[3] = 3n", "kept[3] = null", "kept[3] = 2 ** 40"]),
    "texts": ("for (let i = 0; i < 8; i++) items.push('t' + i);", "total += items[i].length;", ["0", "kept[3] = 7", "kept[3] = [1, 2, 3]", "kept[3] = { length: 'long' }", "delete kept[3]", "kept[3] = null", "kept[3] = new String('wrapped')"]),
    "functions": ("for (let i = 0; i < 8; i++) items.push(x => x + i);", "total += items[i](1);", ["0", "kept[3] = Math.abs", "kept[3] = function () { return 'text'; }", "kept[3] = class { }", "kept[3] = 7", "delete kept[3]", "kept[3] = new Proxy(x => x, { apply() { return 23; } })", "kept[3] = (x => x * 2).bind(null)"]),
    "lists": ("for (let i = 0; i < 8; i++) items.push([i, i + 1]);", "total += items[i][1] + items[i].length;", ["0", "kept[3] = 'ab'", "kept[3] = { 1: 5, length: 2 }", "kept[3] = new Uint8Array(4)", "kept[3][1] = 'text'", "kept[3].length = 1", "delete kept[3]", "kept[3] = [1, 0.5]"]),
}

count = 0
def write(name, text):
    global count
    open(os.path.join(folder, name + ".js"), "w").write(text)
    count += 1

head = "// %s\nconst items = [];\n%s\nglobalThis.kept = items;\n"
for way, made in ways_in.items():
    for change, text in changes.items():
        for read, loop in reads.items():
            for when in ("in-front", "in-the-middle"):
                run = "(0, eval)(%r);" % text
                body = head % ("%s; unseen code: %s, %s of the loop; read %s" % (way, change, when, read), made)
                if when == "in-front":
                    body += run + "\n" + loop.replace("    MIDDLE\n", "")
                else:
                    body += loop.replace("MIDDLE", "if (i === 1) " + run)
                write("-".join((way, change, when, read)), body.replace("-", "-") + "\n")

for kind, (made, use, texts) in others.items():
    for number, text in enumerate(texts):
        for when in ("in-front", "in-the-middle"):
            run = "(0, eval)(%r);" % text
            body = head % ("%s; unseen code: %s, %s of the loop" % (kind, text, when), made)
            loop = "let total = 0;\ntry {\n  for (let i = 0; i < items.length; i++) {\n    MIDDLE\n    " + use + "\n  }\n} catch (error) { console.log(error.constructor.name, error.message.length > 0); }\nconsole.log(typeof total, String(total));"
            if when == "in-front":
                body += run + "\n" + loop.replace("    MIDDLE\n", "")
            else:
                body += loop.replace("MIDDLE", "if (i === 1) " + run)
            write("%s-%d-%s" % (kind, number, when), body + "\n")
print(count, "programs")
