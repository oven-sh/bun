declare const aotOperationCount: (name: string) => number;
function pieces(text: string, size: number): string {
  let out = "";
  for (let at = 0; at < text.length; at += size) out += "[" + text.slice(at, at + size) + "]";
  return out;
}
function measure(name: string, parts: string[]) {
  const text = parts.join(" ");
  const before = aotOperationCount("StringAppend: Latin-1 in 16 bits");
  const made = pieces(text, 4);
  console.log(`${name}: ${made.length} characters, ${aotOperationCount("StringAppend: Latin-1 in 16 bits") - before} pieces found to be Latin-1 in 16 bits`);
}
measure("a wide text", ["abcd", "efg", "hij", "東京東京", "klm"]);
measure("a Latin-1 text", ["abcd", "efg", "hij", "café", "klm"]);
measure("wide pieces alone", ["東京東", "東京東"]);
