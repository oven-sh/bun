// Keys of Maps as a type checker builds them: a helper returns the text, the caller looks it up. Few distinct keys, asked for again and again.
type Item = { id: number };
function listId(items: readonly Item[]): string {
  let result = "";
  const length = items.length;
  let i = 0;
  while (i < length) {
    const startId = items[i]!.id;
    let count = 1;
    while (i + count < length && items[i + count]!.id === startId + count) count++;
    if (result.length) result += ",";
    result += startId;
    if (count > 1) result += ":" + count;
    i += count;
  }
  return result;
}
function aliasId(symbol: Item | undefined, args: readonly Item[] | undefined): string { return symbol ? "@" + symbol.id + (args ? ":" + listId(args) : "") : ""; }
function pairId(a: Item, b: Item): string { return a.id + "," + b.id; }
const items: Item[] = []; for (let i = 0; i < 4096; i++) items.push({ id: i * 7 + 3 });
const lists: Item[][] = []; for (let i = 0; i < 512; i++) lists.push([items[i]!, items[(i * 5) & 4095]!, items[(i * 11 + 1) & 4095]!]);
const byList = new Map<string, number>(), byAlias = new Map<string, number>(), byPair = new Map<string, number>();
let hits = 0;
const which = Number(process.argv[2] ?? 0), rounds = Number(process.argv[3] ?? 2000);
for (let r = 0; r < rounds; r++) {
  const list = lists[r & 511]!;
  if (which === 0 || which === 1) { const id = listId(list); const found = byList.get(id); if (found === undefined) byList.set(id, r); else hits++; }
  if (which === 0 || which === 2) { const id = aliasId(list[0], list); const found = byAlias.get(id); if (found === undefined) byAlias.set(id, r); else hits++; }
  if (which === 0 || which === 3) { const id = pairId(list[0]!, list[1]!); const found = byPair.get(id); if (found === undefined) byPair.set(id, r); else hits++; }
}
console.log(hits, byList.size, byAlias.size, byPair.size);
