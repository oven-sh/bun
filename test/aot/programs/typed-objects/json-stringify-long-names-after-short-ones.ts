// Objects with undeclared keys whose names and values are long are written after short ones of the same fields, alone, under a holder and in arrays: the writer's plans and its buffer.
type Point = { x: number; y: number };
type Named = { id: number; name: string; tags: string[] };
let different = 0;
let texts = 0;
const lengths = [1, 7, 8, 9, 15, 16, 17, 31, 32, 33, 55, 56, 57, 62, 63, 64, 65, 66, 127, 128, 129, 255, 256, 257, 1000, 1023, 1024, 1025, 4095, 4096, 4097, 16384, 65535, 65536, 65537, 100000, 1000000];
function check(value: unknown, text: string): void {
  texts++;
  if (JSON.stringify(value) !== text) different++;
}
for (const character of ["k", "\u00e9", "\u65e5", "\\n", '\\"']) {
  const raw = JSON.parse('"' + character + '"');
  const short = '{"x":1,"y":2,"s":1}';
  const shortValue = JSON.parse<Point>(short);
  for (const length of lengths) {
    if (character.length > 1 && length > 70000) continue;
    const name = character.repeat(length);
    for (const text of ['{"x":1,"y":2,"' + name + '":1}', '{"' + name + '":"' + name + '","x":1,"y":2}', '{"x":1,"' + name + '":[1],"y":2,"' + name + 'b":{"' + name + '":null}}']) {
      const value = JSON.parse<Point>(text);
      const written = JSON.stringify(JSON.parse(text));
      for (let round = 0; round < 4; round++) {
        check(shortValue, short);
        check(value, written);
        check({ held: value, other: shortValue }, '{"held":' + written + ',"other":' + short + "}");
        check([shortValue, value, shortValue, value], "[" + short + "," + written + "," + short + "," + written + "]");
      }
    }
    const named = '{"id":' + length + ',"name":"' + name + '","tags":["' + name + '","t"],"' + name + '":"' + name + '"}';
    const value = JSON.parse<Named>(named);
    const written = JSON.stringify(JSON.parse(named));
    for (let round = 0; round < 4; round++) check(value, written);
    if (value.name.length !== raw.length * length) different++;
  }
  console.log("names and values of " + JSON.stringify(raw) + ": " + texts + " texts: " + different + " differ");
  texts = 0;
}
