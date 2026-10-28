// Objects with undeclared keys are written, dropped and collected; then objects with other keys are parsed, so that new structures lie where the old ones lay, and written.
const host: any = globalThis;
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc;
let serial = 0;
function longText(): string {
  return '"text number ' + ++serial + ' is too long for a cache of short strings"';
}
function freshValue(at: number): string {
  switch (at % 4) {
    case 0:
      return longText();
    case 1:
      return '{"a":' + longText() + ',"b":[' + longText() + "]}";
    case 2:
      return "[" + longText() + "," + ++serial + "]";
    default:
      return longText();
  }
}

type Item = { id: number; name: string };
function generation(number: number): number {
  let different = 0;
  const values: Item[] = [];
  const texts: string[] = [];
  for (let set = 0; set < 60; set++) {
    const members = ['"id":' + set, '"name":' + longText()];
    for (let at = 0; at < 1 + (set % 7); at++) members.splice(1 + (at % 2), 0, '"g' + number + "s" + set + "k" + at + '":' + (at % 2 ? String(number * 1000 + set) : longText()));
    texts.push("{" + members.join(",") + "}");
    values.push(JSON.parse(texts[set]) as Item);
  }
  for (let round = 0; round < 3; round++) for (let set = 0; set < 60; set++) if (JSON.stringify(values[set]) !== texts[set]) different++;
  for (let set = 0; set < 60; set++) if (JSON.stringify({ held: values[set], list: [values[set]] }) !== '{"held":' + texts[set] + ',"list":[' + texts[set] + "]}") different++;
  return different;
}
for (let number = 0; number < 12; number++) {
  const different = generation(number);
  collect();
  collect();
  console.log("generation " + number + ": " + different + " differ");
}
