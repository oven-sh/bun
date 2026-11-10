#!/usr/bin/env python3
# generate-lists-of-integers-that-meet-fractions.py <folder>: one program a deed: a list whose storage holds integers comes to a loop that stores what may be a fraction; whatever is done to the storage in front of the loop, nobody may see it.
import os, sys
head = '''// %s What is printed is what plain Bun prints.
%sconst unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function integers(n: number): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i + 1); return list; }
function scale(list: number[], by: number) { for (let i = 0; i < list.length; i++) list[i] = list[i] * by; }
const factors: number[] = unseen([2, 0.5, 1.5, 0, -1, NaN, Infinity, 2, 0.5]);
'''
tail = '''console.log(told.join("\\n"));
'''
deeds = {
 "plain": ("The list is scaled again and again.", '''const list = integers(5);
for (const by of factors) { scale(list, by); told.push(by + ": " + list.join() + " " + list.length); }'''),
 "stays-integral": ("The factors are 2 and 0.5 in turn: no element is ever a fraction.", '''const list = integers(6);
for (let round = 0; round < 40; round++) scale(list, round & 1 ? 0.5 : 2);
told.push(list.join(), String(list[3] | 0), JSON.stringify(list));'''),
 "two-names-of-one-list": ("A loop around reads the list under another name, as integers, while the loop inside scales it.", '''function both(read: number[], written: number[], by: number): number {
  let sum = 0;
  for (let j = 0; j < read.length; j++) {
    sum += read[j] | 0;
    for (let i = 0; i < written.length; i++) written[i] = written[i] * by;
    sum += read[j] | 0;
  }
  return sum;
}
for (const by of factors) { const one = integers(4); told.push(by + ": " + both(one, one, by) + " " + one.join()); }'''),
 "two-lists": ("The same two loops over two lists.", '''function both(read: number[], written: number[], by: number): number {
  let sum = 0;
  for (let j = 0; j < read.length; j++) {
    sum += read[j] | 0;
    for (let i = 0; i < written.length; i++) written[i] = written[i] * by;
    sum += read[j] | 0;
  }
  return sum;
}
for (const by of factors) { const a = integers(3), b = integers(3); told.push(by + ": " + both(a, b, by) + " " + a.join() + " " + b.join()); }'''),
 "read-as-integers-around": ("Loops in front of and behind the scaling read the list as integers.", '''function around(list: number[], by: number): string {
  const first = list[0] | 0, length = list.length;
  let before = 0;
  for (let i = 0; i < list.length; i++) before += list[i] & 7;
  scale(list, by);
  let behind = 0;
  for (let i = 0; i < list.length; i++) behind += list[i] & 7;
  return [first, length, before, behind, list[0], list[list.length - 1]].join();
}
for (const by of factors) told.push(by + ": " + around(integers(6), by));'''),
 "integers-stored-again": ("Behind the scaling a loop stores integers into the same list.", '''function again(list: number[], by: number): string {
  scale(list, by);
  for (let i = 0; i < list.length; i++) list[i] = i * 3;
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum + "," + list.join();
}
for (const by of factors) told.push(by + ": " + again(integers(5), by));'''),
 "grows-in-the-loop": ("The list grows in a turn.", '''function grown(list: number[], by: number): string {
  for (let i = 0; i < list.length && i < 12; i++) { list[i] = list[i] * by; if (i === 2) list.push(100); }
  return list.join();
}
for (const by of factors) told.push(by + ": " + grown(integers(4), by));'''),
 "is-cut-in-the-loop": ("The list is cut in a turn.", '''function cut(list: number[], by: number): string {
  for (let i = 0; i < list.length; i++) { list[i] = list[i] * by; if (i === 1) list.length = 3; }
  return list.join() + "/" + list.length;
}
for (const by of factors) told.push(by + ": " + cut(integers(6), by));'''),
 "no-turn": ("The list is empty: the loop takes no turn.", '''for (const by of factors) { const list = integers(0); scale(list, by); list.push(7); told.push(by + ": " + JSON.stringify(list) + (list[0] | 0)); }'''),
 "a-hole": ("The list has a hole.", '''for (const by of factors) { const list = integers(5); delete list[2]; scale(list, by); told.push(by + ": " + JSON.stringify(list) + (2 in list) + list.length); }'''),
 "a-written-list": ("The list is written as a literal, which two evaluations may share.", '''function written(): number[] { return [1, 2, 3, 4]; }
for (const by of factors) { const list = written(); scale(list, by); told.push(by + ": " + list.join() + " | " + written().join()); }'''),
 "frozen": ("The list is frozen.", '''for (const by of factors) { const list = integers(3); Object.freeze(list); let how = "done"; try { scale(list, by); } catch (error) { how = (error as Error).constructor.name; } told.push(by + ": " + how + " " + list.join()); }'''),
 "sealed": ("The list is sealed.", '''for (const by of factors) { const list = integers(3); Object.seal(list); scale(list, by); told.push(by + ": " + list.join() + Object.isSealed(list)); }'''),
 "a-name-on-it": ("The list has a property under a name.", '''for (const by of factors) { const list: any = integers(3); list.extra = "kept"; scale(list, by); told.push(by + ": " + list.join() + list.extra + Object.keys(list).join()); }'''),
 "far-apart": ("The elements lie far apart.", '''for (const by of factors) { const list = integers(1); list[5000] = 2; scale(list, by); told.push(by + ": " + list[0] + "," + list[5000] + "," + list.length + "," + (17 in list)); }'''),
 "an-accessor-at-a-place": ("A place of the list is an accessor.", '''for (const by of factors) { const list = integers(3); Object.defineProperty(list, 1, { get: () => 40, set() { told.push("set"); }, configurable: true }); scale(list, by); told.push(by + ": " + list.join()); }'''),
 "kept-by-others": ("Others hold the list: a closure, a field, a Map; each reads it behind the scaling.", '''const list = integers(4), holder = { list }, map = new Map([["k", list]]), read = () => list[1] | 0;
for (const by of factors) { scale(unseen(list), by); told.push(by + ": " + read() + "," + holder.list[2] + "," + map.get("k")![3] + "," + list.indexOf(2) + "," + list.includes(NaN)); }'''),
 "across-an-await": ("A suspension stands between the reads and the scaling.", '''async function waits(list: number[], by: number): Promise<string> {
  const first = list[0] | 0;
  await null;
  for (let i = 0; i < list.length; i++) list[i] = list[i] * by;
  await null;
  return first + "," + list.join();
}
for (const by of factors) told.push(by + ": " + (await waits(integers(3), by)));'''),
 "methods-behind-it": ("Built-in methods take the list behind the scaling.", '''for (const by of factors) { const list = integers(5); scale(list, by); told.push(by + ": " + [list.slice(1, 3).join(), list.map(x => x + 1).join(), list.reduce((a, b) => a + b, 0), list.concat([9]).join(), [...list].reverse().join(), list.lastIndexOf(4), Math.max(...list), list.sort().join()].join(" ")); }'''),
}
neverConverted = { "an-accessor-at-a-place", "grows-in-the-loop", "is-cut-in-the-loop", "kept-by-others" }
folder = sys.argv[1]
os.makedirs(folder, exist_ok=True)
for name, (says, deed) in deeds.items():
    counted = "" if name in neverConverted else "// STATISTIC: ListsConvertedInFrontOfTypedCopies >= 1\n"
    open(os.path.join(folder, name + ".ts"), "w").write(head % (says, counted) + deed + "\n" + tail)
print(len(deeds), "programs")
