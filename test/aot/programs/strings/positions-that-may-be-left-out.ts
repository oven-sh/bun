// `text.slice(from, to)` where `to` is a number or undefined, and the other methods of strings that take a position: each is compiled in line for both cases, and answers as in plain Bun.
// STATISTIC: InlineBuiltinGroups >= 12
const positions: (number | undefined)[] = [undefined, 0, 1, 3, 6, 7, -1, -3, -7, 1.5, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31), 1e20];
const texts: string[] = ["a,b!c,", "", "€,€!", "a,b" + String(positions.length).slice(0, 1) + "!c,"];

function slice(text: string, from: number, to?: number): string {
  return text.slice(from, to);
}
function sliceFrom(text: string, from?: number): string {
  return text.slice(from);
}
function substring(text: string, from: number, to?: number): string {
  return text.substring(from, to);
}
function substr(text: string, from: number, length?: number): string {
  return text.substr(from, length);
}
function indexOf(text: string, sought: string, from?: number): number {
  return text.indexOf(sought, from);
}
function lastIndexOf(text: string, sought: string, from?: number): number {
  return text.lastIndexOf(sought, from);
}
function includes(text: string, sought: string, from?: number): boolean {
  return text.includes(sought, from);
}
function startsWith(text: string, sought: string, at?: number): boolean {
  return text.startsWith(sought, at);
}
function endsWith(text: string, sought: string, end?: number): boolean {
  return text.endsWith(sought, end);
}
function upToQuery(url: string, start: number): string {
  const query = url.indexOf("!", start);
  return url.slice(start, query === -1 ? undefined : query);
}

for (const text of texts) {
  const sought = text.length > 1 ? text[1] : ",";
  for (const position of positions) {
    console.log(
      JSON.stringify([
        slice(text, 1, position), sliceFrom(text, position), substring(text, 1, position), substr(text, 1, position), indexOf(text, sought, position), lastIndexOf(text, sought, position),
        includes(text, sought, position), startsWith(text, sought, position), endsWith(text, sought, position), upToQuery(text, position ?? 0),
      ]),
    );
  }
}
