#!/usr/bin/env python3
# write-flat.py <folder>: each program: a reader of characters whose text is made flat, a suspension, and a reader behind it. While the reader is suspended the text becomes a key:
# it is 16 bits wide as made, the key of the same characters is 8 bits wide, so the cell gets other characters of another width, and a collection frees the old ones.
import sys, os
folder = sys.argv[1]
head = '''const table: Record<string, number> = {};
const held = { text: "" };
function made(n: number) {
  return ("\\u0100" + "abcdefgh".repeat(n)).slice(1);
}
function fill() {
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += ("\\u0100" + String(i % 10).repeat(700 + (i & 63))).slice(1).charCodeAt(3) + ("y" + String(i % 10).repeat(700 + (i & 63))).slice(1).charCodeAt(3);
  return sum;
}
function disturbNow() {
  const found = table[held.text] ?? 0;
  held.text = "";
  Bun.gc(true);
  return found + fill();
}
let size = 90;
function next() {
  size++;
  table["abcdefgh".repeat(size)] = 7;
  held.text = made(size);
}
'''
asyncTail = '''async function disturb() {
  await null;
  return disturbNow();
}
async function deed() {
  next();
  const pending = scan(held.text);
  const disturbed = disturb();
  return String(await pending) + ":" + String(await disturbed);
}
console.log(await deed());
for (let i = 0; i < 6; i++) await deed();
console.log(await deed());
'''
generatorTail = '''function deed() {
  next();
  const steps = scan(held.text);
  const first = steps.next().value;
  const disturbed = disturbNow();
  let last = first;
  for (let step = steps.next(); !step.done; step = steps.next()) last = step.value;
  return String(first) + ":" + String(last) + ":" + String(disturbed);
}
console.log(deed());
for (let i = 0; i < 6; i++) deed();
console.log(deed());
'''
loop = 'for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;'
programs = {
 'two-loops-read-a-text-and-an-await-stands-between-them': ('// the first loop makes the text flat in front of itself, and the second stands behind three awaits\n', f'''async function scan(text: string) {{
  let h = 0;
  {loop}
  await null;
  await null;
  await null;
  {loop}
  return h;
}}
''', asyncTail),
 'a-loop-reads-a-text-and-awaits-in-some-turns': ('// a loop that may suspend has nothing made in front of it\n', '''async function scan(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
    if (i % 300 === 1) await null;
    h = (h * 33 + text.charCodeAt(i)) | 0;
  }
  return h;
}
''', asyncTail),
 'a-loop-in-a-loop-reads-a-text-and-the-outer-one-awaits': ('// the inner loop never suspends, the outer one does: the flat text stands in front of the inner loop in each turn of the outer one, not in front of both\n', f'''async function scan(text: string) {{
  let h = 0;
  for (let row = 0; row < 4; row++) {{
    {loop}
    await null;
  }}
  return h;
}}
''', asyncTail),
 'two-loops-of-a-generator-read-a-text-and-a-yield-stands-between-them': ('// as with an await, in a generator\n', f'''function* scan(text: string) {{
  let h = 0;
  {loop}
  yield h;
  {loop}
  yield h;
}}
''', generatorTail),
 'a-loop-of-a-generator-reads-a-text-and-yields-in-some-turns': ('// some turns suspend between two reads\n', '''function* scan(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
    if (i % 300 === 1) yield h;
    h = (h * 33 + text.charCodeAt(i)) | 0;
  }
  yield h;
}
''', generatorTail),
 'a-loop-behind-an-await-reads-the-text-that-a-loop-in-a-copied-function-has-read': ('// the first reader is a small function that is copied into the coroutine\n', f'''function digest(text: string) {{
  let h = 0;
  {loop}
  return h;
}}
async function scan(text: string) {{
  let h = digest(text);
  await null;
  await null;
  return (h * 31 + digest(text)) | 0;
}}
''', asyncTail),
 'reads-behind-tests-of-the-length-and-an-await-between-them': ('// no loop: the second reader on one way makes the text flat for himself and all that follow, and what follows behind the await is none of them\n', '''async function scan(text: string) {
  let h = 0;
  const at = held.text.length - text.length;
  if (at >= 0 && at < text.length) h = text.charCodeAt(at);
  if (at + 1 < text.length && at + 1 >= 0) h = (h * 31 + text.charCodeAt(at + 1)) | 0;
  if (at + 2 < text.length && at + 2 >= 0) h = (h * 31 + text.charCodeAt(at + 2)) | 0;
  await null;
  await null;
  if (at + 3 < text.length && at + 3 >= 0) h = (h * 31 + text.charCodeAt(at + 3)) | 0;
  if (at + 4 < text.length && at + 4 >= 0) h = (h * 31 + text.charCodeAt(at + 4)) | 0;
  return h;
}
''', asyncTail),
 'a-text-becomes-a-key-in-a-turn-of-the-loop-that-reads-it': ('// no suspension: the call in the turn makes the text a key and collects. The cell stands on the stack, so its old characters stay\n', '''function scan(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
    if (i === 200) h = (h + disturbNow()) | 0;
  }
  return h;
}
''', '''function deed() {
  next();
  return String(scan(held.text));
}
console.log(deed());
for (let i = 0; i < 6; i++) deed();
console.log(deed());
'''),
}
for name, (comment, scan, tail) in programs.items():
    open(os.path.join(folder, name + '.ts'), 'w').write(comment + head + scan + tail)
print(len(programs))
