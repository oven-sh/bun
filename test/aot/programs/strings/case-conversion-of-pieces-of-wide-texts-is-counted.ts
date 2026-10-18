declare const aotOperationCount: (name: string) => number;
function measure(name: string, words: string[]) {
  const before = aotOperationCount("convertCase: ASCII in 16 bits");
  let length = 0;
  for (const word of words) length += word.toLowerCase().length + word.toUpperCase().length;
  console.log(`${name}: ${length} characters, ${aotOperationCount("convertCase: ASCII in 16 bits") - before} conversions of ASCII found in 16 bits`);
}
const made = (...parts: string[]) => parts.join(" ").split(" ");
measure("pieces of a wide text", made("One two", "THREE", "東京", "four"));
measure("pieces of a Latin-1 text", made("One two", "THREE", "café", "four"));
measure("wide pieces", made("東京", "大阪"));
