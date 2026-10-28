// A string that is only appended to is built in one buffer instead of a rope.
// IR+ ^ .* = StringBuilderBegin
// IR+ ^ .* = StringBuilderFinish 
// IR= 0 listItems Strcat
const log: string[] = [];
let sum = 0;
function note(label: string, text: string): void {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  sum = (sum * 33 + hash) | 0;
  console.log(label, text.length, hash, text.length <= 120 ? JSON.stringify(text) : JSON.stringify(text.slice(0, 50) + ".." + text.slice(-50)));
}

interface Item {
  id: number;
  name: string;
  tags: string[];
  children: Item[];
  weight: number | null;
  note?: string;
}

function attribute(name: string, value: string): string {
  let escaped = "";
  for (let i = 0; i < value.length; i++) {
    const character = value[i]!;
    escaped += character === '"' ? "&quot;" : character === "&" ? "&amp;" : character;
  }
  return ` ${name}="${escaped}"`;
}

function listItems(tags: string[]): string {
  let html = "";
  for (const tag of tags) html += `<li${attribute("data-tag", tag)}>${tag}</li>`;
  return html;
}

function tree(item: Item, depth: number): string {
  let children = "";
  for (const child of item.children) children += tree(child, depth + 1);
  return `<div${attribute("id", "item-" + item.id)} data-depth="${depth}" data-weight="${item.weight}"><b>${item.name}</b>${
    item.tags.length ? `<ul>${listItems(item.tags)}</ul>` : ""
  }${item.note === undefined ? "" : `<p>${item.note}</p>`}${children}</div>`;
}

function row(cells: (string | number | null | undefined | boolean)[]): string {
  let html = "<tr>";
  for (let i = 0; i < cells.length; i++) {
    if (i % 2) html += `<td class="odd">${cells[i]}</td>`;
    else html += "<td>" + cells[i] + "</td>";
  }
  return html + "</tr>";
}

function table(rows: (string | number | null | undefined | boolean)[][], caption: string | null): string {
  let body = "";
  let count = 0;
  for (const cells of rows) {
    if (cells.length === 0) continue;
    body += row(cells);
    count++;
    if (count === 5) break;
  }
  return `<table>${caption === null ? "" : `<caption>${caption}</caption>`}${body}<tfoot>${count}</tfoot></table>`;
}

const texts = ["", "a", "plain", 'quo"te', "a&b", "café", "日本語", "😀", "\ud83d", "\ude00x", "x".repeat(40), "ÿ".repeat(70), "y".repeat(5000), "—".repeat(300)];
const numbers = [0, -0, 1, -1, 9, 10, 99, 100, 12345, 2147483647, -2147483648, 2147483648, 4294967296, 2 ** 53, 0.1, -0.5, 1.5, 1e21, 1e-7, 123456789.125, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308];

function makeItem(seed: number, depth: number): Item {
  const children: Item[] = [];
  for (let k = 0; depth > 0 && k < (seed % 3) + 1; k++) children.push(makeItem(seed * 7 + k + 1, depth - 1));
  const item: Item = {
    id: seed,
    name: texts[seed % texts.length]!,
    tags: texts.slice(seed % 5, (seed % 5) + (seed % 4)),
    children,
    weight: seed % 4 === 0 ? null : numbers[seed % numbers.length]!,
  };
  if (seed % 3 === 0) item.note = texts[(seed * 5) % texts.length]!;
  return item;
}

for (const text of texts) {
  note("attribute", attribute("title", text));
  note("listItems", listItems([text, "x", text]));
}
note("listItems", listItems([]));
for (let seed = 0; seed < 12; seed++) note("tree " + seed, tree(makeItem(seed, seed % 4), 0));
note("table", table([], null));
note("table", table([[]], "empty"));
note("table", table([numbers, texts, [null, undefined, true, false], [], ["a"], [1, "b", null], numbers, texts], "日本"));
for (const number of numbers) note("row", row([number, number, String(number)]));

function usedTwice(item: Item): string {
  const head = tree(item, 1);
  return head.length + ":" + head + "|" + head;
}
note("usedTwice", usedTwice(makeItem(3, 1)));

function compared(item: Item): string {
  const inner = listItems(item.tags);
  return inner === "" ? "<none/>" : `<some>${inner}</some>`;
}
note("compared", compared(makeItem(1, 0)));
note("compared", compared(makeItem(5, 0)));

const byValue: ((tags: string[]) => string)[] = [listItems, tags => `[${listItems(tags)}]`];
for (const render of byValue) note("byValue", render(["p", "q"]));
note("mapped", [["a"], ["b", "c"], []].map(listItems).join("+"));

function noisy(label: string): string {
  log.push(label);
  return `<${label}>`;
}
function ordered(a: string, b: string): string {
  return `${noisy(a)}-${listItems([noisy(b)])}-${noisy(a + b)}` + noisy("last");
}
note("ordered", ordered("x", "y"));
note("log", log.join(","));

class Failure extends Error {}
function failing(tags: string[], at: number): string {
  let html = "<f>";
  for (let i = 0; i < tags.length; i++) {
    if (i === at) throw new Failure("at " + i);
    html += `<i>${attribute("n", tags[i]!)}</i>`;
  }
  return html + "</f>";
}
function guarded(tags: string[], at: number): string {
  try {
    return failing(tags, at);
  } catch (error) {
    return error instanceof Failure ? `(${error.message})` : "?";
  }
}
function around(tags: string[], at: number): string {
  return `<a>${listItems(tags)}${guarded(tags, at)}${listItems(tags)}</a>`;
}
for (let at = -1; at < 4; at++) note("around " + at, around(["1", "2", "3"], at));
function outer(tags: string[], at: number): string {
  return `<o>${listItems(tags)}${failing(tags, at)}</o>`;
}
for (let at = -1; at < 3; at++) {
  let text: string;
  try {
    text = outer(["1", "2"], at);
  } catch (error) {
    text = "caught " + (error as Error).message;
  }
  note("outer " + at, text + listItems(["after"]));
}

function deep(n: number): string {
  return n === 0 ? "." : `(${deep(n - 1)}${n % 10})`;
}
note("deep", deep(2000));

function early(tags: string[], limit: number): string {
  let html = "";
  for (const tag of tags) {
    if (html.length > limit) return html + "..";
    html += `${tag},`;
  }
  return html;
}
note("early", early(["aa", "bb", "cc", "dd"], 4));
note("early", early(["aa", "bb"], 40));

function branches(kind: number, text: string): string {
  if (kind === 0) return "";
  if (kind === 1) return text;
  if (kind === 2) return `<2>${text}</2>`;
  if (kind === 3) return listItems([text]);
  const inner = kind === 4 ? `<4>${listItems([text, text])}</4>` : kind === 5 ? text : "";
  return `[${inner}]`;
}
function allBranches(text: string): string {
  let html = "";
  for (let kind = 0; kind < 7; kind++) html += `${kind}:${branches(kind, text)};`;
  return html;
}
for (const text of texts) note("branches", allBranches(text));
function blocks(lines: string[]): string {
  let html = "";
  let at = 0;
  while (at < lines.length) {
    const line = lines[at]!;
    if (line === "") {
      at++;
    } else if (line.startsWith("# ")) {
      html += `<h1>${attribute("id", line)}${line.slice(2)}</h1>\n`;
      at++;
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (at < lines.length && lines[at]!.startsWith("- ")) items.push(lines[at++]!.slice(2));
      html += `<ul>${listItems(items)}</ul>\n`;
    } else {
      html += `<p>${line}</p>\n`;
      at++;
    }
  }
  return html;
}
note("blocks", blocks([]));
note("blocks", blocks(["", "", ""]));
note("blocks", blocks(["# head", "", "text", "- a", "- b", "", "- 日本", "more — text", "# end"]));
const manyLines: string[] = [];
for (let i = 0; i < 3000; i++) manyLines.push(i % 7 === 0 ? "" : i % 5 === 0 ? "# " + i : i % 3 === 0 ? "- item " + i : "line " + i);
note("blocks", blocks(manyLines));
function digits(count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) text += ((i * 2654435761) % 4294967296).toString(16);
  return text;
}
note("digits", digits(0));
note("digits", digits(1));
note("digits", digits(2));
note("digits", digits(10000));
function inEveryRadix(numbers: number[]): string {
  let text = "";
  for (const number of numbers) {
    text += number.toString(2);
    text += `|${number.toString(7)}|${number.toString(10)}|${number.toString()}|${number.toString(16)}|${number.toString(36)};`;
  }
  return text;
}
note("inEveryRadix", inEveryRadix([]));
note("inEveryRadix", inEveryRadix([0, -0, 1, -1, 255, -255, 2147483647, -2147483648, 2147483648, 4294967295, 9007199254740991]));
note("inEveryRadix", inEveryRadix([0.5, -0.5, 1 / 3, -1 / 7, 0.1, 1e21, -1e21, 1e-7, 123456.789, 5e-324, 1.7976931348623157e308]));
note("inEveryRadix", inEveryRadix([NaN, Infinity, -Infinity]));
function anyRadix(number: number, radix: number): string {
  let text = "";
  for (let i = 0; i < 2; i++) text += number.toString(radix);
  return text;
}
for (const radix of [2, 36, 1, 37, 0, NaN]) {
  try {
    note("anyRadix", anyRadix(254.5, radix));
  } catch (error) {
    console.log("anyRadix", radix, (error as Error).name);
  }
}
function once(words: string[], from: number): string {
  let text = "";
  for (let k = from; k < from + 1 && k < words.length; k++) text += words[k]!;
  return text;
}
for (let i = 0; i <= texts.length; i++) note("once", once(texts, i));
console.log("the same string", once(texts, 2) === texts[2], once(["a"], 3) === "");
function counted(limit: number): string {
  let text = "";
  for (let i = 0; i < limit; i++) text += i;
  for (let i = 0; i < limit; i++) text += i / 4;
  return text;
}
note("counted", counted(0));
note("counted", counted(1));
note("counted", counted(300));
function guardedLoop(words: string[]): string {
  let before = "";
  try {
    if (words.length > 90) throw new Failure("many");
    before = "few";
  } catch (error) {
    before = (error as Error).message;
  }
  let text = "";
  for (const word of words) text += `<${word}|${before}>`;
  return text;
}
note("guardedLoop", guardedLoop(texts));
note("guardedLoop", guardedLoop(new Array<string>(100).fill("w")));
console.log("sum", sum);
async function later(text: string): Promise<string> {
  await null;
  log.push("later " + text);
  return text;
}
async function awaitsBetweenLoops(words: string[]): Promise<string> {
  const first = await later("first");
  let html = "<ul>";
  for (const word of words) html += `<li class="${first}">${word}</li>`;
  html += "</ul>";
  const last = await later("last");
  return html + last;
}
async function awaitsInTemplate(flag: boolean, word: string): Promise<string> {
  return `<a>${flag ? `[${word}|${word.length}]` : "none"}${await later(word)}${flag ? "yes" : `no ${word}`}</a>`;
}
async function awaitsInLoop(words: string[]): Promise<string> {
  let html = "";
  for (const word of words) html += `<p>${await later(word)}:${word.length}</p>`;
  return html;
}
async function interleaved(): Promise<void> {
  const results = await Promise.all([
    awaitsInTemplate(true, "one"),
    awaitsBetweenLoops(texts),
    awaitsInTemplate(false, "two"),
    awaitsInLoop(["a", "b", "c"]),
    awaitsInTemplate(true, "three"),
    awaitsInLoop(texts),
  ]);
  for (const result of results) note("async", result);
  console.log("sum", sum, log.length);
}
interleaved();
