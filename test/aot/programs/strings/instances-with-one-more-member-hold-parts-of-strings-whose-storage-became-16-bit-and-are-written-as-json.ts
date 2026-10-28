// A string that is looked up as a property key takes the storage of the equal key that is there, of either width. Parts of it were made before, and are fields of instances that have got one more member and are written as JSON.
const keys: Record<string, number> = {};
const in16Bits = (text: string): string => Buffer.from(text, "utf16le").toString("utf16le");
const in8Bits = (text: string): string => Buffer.from(text, "latin1").toString("latin1");
function becomes16Bit(text: string): string {
  keys[in16Bits(text)] = 1;
  return in8Bits(text);
}
function lookUp(text: string): void {
  if (keys[text] !== 1) console.log("no key " + text);
}
class Entry {
  name: string;
  count: number;
  note: string;
  constructor(name: string, count: number, note: string) {
    this.name = name;
    this.count = count;
    this.note = note;
  }
}
function writeOuter(outer: { id: number; inner: Entry }): string {
  return JSON.stringify(outer);
}
function writeList(list: Entry[]): string {
  return JSON.stringify(list);
}
function writeOne(entry: Entry): string {
  return JSON.stringify(entry);
}
function writeInText(entry: Entry, round: number): string {
  return "<" + round + JSON.stringify({ round, entry }) + ">";
}
for (let round = 0; round < 3; round++) {
  const whole = becomes16Bit("<<a name of round " + round + ' that is rather long, and a "quote">>');
  const parts = [0, 1, 2, 3, 4, 5, 6, 7].map(() => whole.slice(2, -2));
  lookUp(whole);
  const entries = parts.map((part, at) => {
    const entry = new Entry(at & 1 ? part : "plain", at, at & 1 ? "plain" : part);
    (entry as any)["extra" + (at >> 1)] = at;
    return entry;
  });
  console.log(writeOuter({ id: round, inner: entries[0] }));
  console.log(writeOuter({ id: round, inner: entries[1] }));
  console.log(writeList([entries[2], entries[3]]));
  console.log(writeOne(entries[4]), writeOne(entries[5]));
  console.log(writeInText(entries[6], round), writeInText(entries[7], round));
}
