// A template of eight or more parts that stands in a loop and whose one use stores it into an array is built flat in the buffer; any other template stays a rope.
// IR= 1 pushed CallBuiltin StringAppendBegin
// IR= 1 byIndex CallBuiltin StringAppendBegin
// IR= 0 pushedOnce CallBuiltin StringAppendBegin
// IR= 0 returned CallBuiltin StringAppendBegin
// IR= 0 concatenatedAgain CallBuiltin StringAppendBegin
// IR= 0 usedTwice CallBuiltin StringAppendBegin
// IR= 0 fewParts CallBuiltin StringAppendBegin
// IR= 0 longConstantText CallBuiltin StringAppendBegin
// IR= 0 inAField CallBuiltin StringAppendBegin
interface Row { id: number; name: string; price: number }
interface Line { text: string; length: number }
const rows: Row[] = [
  { id: 1, name: "plain", price: 1.5 },
  { id: -2, name: "café", price: 0 },
  { id: 3, name: "日本語", price: 1e21 },
  { id: 4, name: "", price: -0 },
  { id: 5, name: "x".repeat(300), price: NaN },
];
function pushed(list: Row[]): string[] {
  const lines: string[] = [];
  for (const row of list) lines.push(`${row.id},${row.name},${row.price};${row.id + 1}:${row.name}`);
  return lines;
}
function byIndex(list: Row[], out: string[]): void {
  for (let i = 0; i < list.length; i++) out[i] = `${i}=${list[i]!.name}/${list[i]!.id}/${list[i]!.price}/${i + 1}`;
}
function pushedOnce(row: Row, lines: string[]): void {
  lines.push(`${row.id},${row.name},${row.price};${row.id + 1}:${row.name}`);
}
function returned(row: Row): string {
  return `${row.id},${row.name},${row.price};${row.id + 1}:${row.name}`;
}
function concatenatedAgain(list: Row[]): string {
  const first = `${list[0]!.id},${list[0]!.name},${list[0]!.price};${list[1]!.id}:${list[1]!.name}`;
  return first + list.length;
}
function usedTwice(list: Row[], lines: string[]): number {
  let length = 0;
  for (const row of list) {
    const line = `${row.id},${row.name},${row.price};${row.id + 1}:${row.name}`;
    lines.push(line);
    length += line.length;
  }
  return length;
}
function fewParts(list: Row[]): string[] {
  const lines: string[] = [];
  for (const row of list) lines.push(`${row.id}-${row.name}-${row.price}`);
  return lines;
}
function longConstantText(list: Row[]): string[] {
  const lines: string[] = [];
  for (const row of list)
    lines.push(
      `${row.id}: this constant text is far longer than what is worth copying into every string that is made from it, because a rope shares it with every other string made here and a flat string holds a copy of its own; it goes on for more than two hundred and fifty-six characters so that it is over the limit ${row.name} ${row.price} ${row.id} ${row.name}`,
    );
  return lines;
}
function inAField(row: Row, line: Line): void {
  line.text = `${row.id}|${row.name}|${row.price}|${row.name}|${row.id}`;
}
function show(label: string, text: string): void {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  console.log(label, text.length, hash, JSON.stringify(text.length <= 60 ? text : text.slice(0, 28) + ".." + text.slice(-28)));
}
const builders = [pushed, fewParts, longConstantText];
for (const build of builders) for (const text of build(rows)) show(build.name, text);
const out: string[] = [];
for (const store of [byIndex]) store(rows, out);
for (const text of out) show("byIndex", text);
const once: string[] = [];
for (const push of [pushedOnce]) for (const row of rows) push(row, once);
for (const text of once) show("pushedOnce", text);
for (const make of [returned]) for (const row of rows) show("returned", make(row));
for (const make of [concatenatedAgain]) show("concatenatedAgain", make(rows));
const twice: string[] = [];
for (const count of [usedTwice]) console.log("usedTwice", count(rows, twice));
for (const text of twice) show("usedTwice", text);
for (const put of [inAField]) {
  for (const row of rows) {
    const line: Line = { text: "", length: 0 };
    put(row, line);
    show("inAField", line.text);
  }
}
