// The rule for containers that hold external data is about primitive elements. An array of promises or of objects derived from external data keeps its element type: what such objects are is decided by their own types.
type Part = { id?: number; name?: string };
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R); }
async function both(): Promise<string> {
  const [first, second] = await Promise.all([later<{ k: Part }>('{"k":{"id":1}}'), later<{ e: string }>('{"e":"x"}')]);
  return JSON.stringify(first.k) + second.e;
}
const parsed = JSON.parse('{"items":[{"id":1},{"id":2}]}') as { items: Part[] };
function objects(): string {
  const picked = [parsed.items[0], parsed.items[1]];
  picked.push(parsed.items[0]);
  let ids = "";
  for (const part of picked) ids += part.id;
  return ids + picked.length;
}
console.log(await both(), objects());
