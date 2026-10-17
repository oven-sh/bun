// Objects the program makes itself stay typed when external data is nearby: a table of functions, and a Map or Set, are not external data.
const data = JSON.parse('{"t":"abc","name":"n"}') as { t: number; name: string };
const table = { first() { return 1; }, second: () => 2, label: "table" };
const other: { first?: unknown; label?: unknown } = {};
other.first = data.t;
other.label = data.name;
export const one = table.first();
export const two = table.second();
const names = new Set<string>();
const byName = new Map<string, { count: number }>();
function remember(name: string): number {
  names.add(name);
  const known = byName.get(name);
  if (known) return ++known.count;
  byName.set(name, { count: 1 });
  return 1;
}
console.log(one + two, table.label, remember(data.name), remember(data.name), names.size, byName.size, names.has("n"), [...byName.keys()].join());
