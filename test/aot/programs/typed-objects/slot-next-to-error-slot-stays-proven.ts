// A place for an Error takes anything. The place beside it, for a Map, is a fact as before, and so is the record's own number.
// IRT= 1 note [(]-, undefined.null.Map annotated[)]
// IRT= 1 note CallBuiltin .* Map.size
interface Seen { count: number }
function note(e: Error, seen: Map<string, Seen>): number {
  const key = String(e);
  const held = seen.get(key);
  if (held) held.count++;
  else seen.set(key, { count: 1 });
  let all = 0;
  for (const one of seen.values()) all += one.count;
  return all * 10 + seen.size;
}
(globalThis as { kept?: unknown }).kept = [note];
const seen = new Map<string, Seen>();
for (const thrown of ["boom", new Error("real"), "boom", 7] as unknown[]) console.log(note(thrown as Error, seen));
