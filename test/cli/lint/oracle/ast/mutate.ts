// Puts comments between the tokens of each input, to test what finds positions in the text next to a node.
//
//   bun mutate.ts <typescript-estree> <inputs.jsonl> <mutated.jsonl> [seed] [share of the gaps that get a comment]
//
// The comments contain what such a search looks for: brackets, colons, arrows, quotes.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [estree, inputs, output, seedText = "1", shareText = "0.5"] = process.argv.slice(2);
const { parse } = require(join(resolve(estree), "dist/index.js"));
const share = Number(shareText);

let state = 1;
/** Where the numbers start for `text`: the same, whatever else is in the list. */
const seedOf = (text: string) => {
  let hash = (2166136261 ^ Number(seedText)) >>> 0;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash || 1;
};
const random = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 2 ** 32;
};
const inside = ["(", ")", "<", ">", ":", "=>", "{", "}", "[", "]", ",", ";", "=", "?", "...", "@", "|", "from", "as", "//", '"', "'", "`", "${", "\\", "é", "😀"];
const comment = () => {
  const text = inside[Math.floor(random() * inside.length)];
  const kind = random();
  if (kind < 0.7) return `/*${text}*/`;
  if (kind < 0.85) return ` /* ${text}\n ${text} */ `;
  return `//${text}\n`;
};

const out: string[] = [];
for (const line of readFileSync(inputs, "utf8").split("\n").filter(Boolean)) {
  const input = JSON.parse(line);
  let tokens: { range: [number, number] }[];
  try {
    tokens = parse(input.code, { range: true, tokens: true, jsx: /x$/.test(input.filename), filePath: input.filename }).tokens;
  } catch {
    continue;
  }
  state = seedOf(input.code);
  let code = "", at = 0;
  for (const token of tokens) {
    code += input.code.slice(at, token.range[0]);
    if (random() < share) code += comment();
    at = token.range[0];
  }
  code += input.code.slice(at);
  out.push(JSON.stringify({ ...input, id: `${input.id}~${seedText}`, code }));
}
writeFileSync(output, out.join("\n") + "\n");
console.log(`${out.length} inputs in ${output}`);
