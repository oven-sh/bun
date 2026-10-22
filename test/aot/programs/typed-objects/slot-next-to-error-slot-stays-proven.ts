// `Error` as a written type is a view: any object passes, and a primitive throws a TypeError at the cast. The parameter beside it, a Map, is tested for its class, and the record's own number stays a number.
// IRT= 1 note \(anything, \S*Map\S*\) ->
// IRT= 1 note CallBuiltin .* overload=MapPrototypeSize/
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
for (const thrown of ["boom", new Error("real"), "boom", 7] as unknown[]) {
  try { console.log(note(thrown as Error, seen)); } catch (e) { console.log("throws", (e as Error).constructor.name); }
}
