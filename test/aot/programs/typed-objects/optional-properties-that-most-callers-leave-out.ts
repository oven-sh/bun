// A component reads four optional properties; each caller gives some of them, as callers of components and of functions with an options object do.
type TextProps = { children?: unknown; color?: string; bold?: boolean; dim?: boolean };

const word = process.argv[3] ?? "";
const open = new Function("value", "return value" + word.slice(word.length)) as <V>(value: V) => V;

function weigh(props: TextProps): number {
  let weight = 0;
  if (props.color !== undefined) weight += props.color.length;
  if (props.bold) weight += 10;
  if (props.dim) weight += 100;
  if (props.children !== undefined) weight += 1000;
  return weight;
}

const muted: TextProps = { color: "245", dim: true, children: "a" };
const accent: TextProps = { color: "213", bold: true, children: "b" };
const plain: TextProps = { children: "c" };
const empty: TextProps = {};
const full: TextProps = { children: "d", color: "1", bold: false, dim: false };
const all = open([muted, accent, plain, empty, full, plain, muted, plain]);

const rounds = Number(process.argv[2] ?? 200000);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += weigh(all[i & 7]);
console.log(sum);
