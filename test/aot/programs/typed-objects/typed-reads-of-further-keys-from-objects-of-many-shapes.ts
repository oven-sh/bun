// A typed read of a name beyond the declared type, at one place, from objects that share their declared part and differ in their further keys.
interface Named {
  id: number;
  [key: string]: unknown;
}

function labelOf(named: Named): unknown {
  return named.label;
}

function describe(value: unknown): string {
  return typeof value + ":" + String(value);
}

const made: Named[] = [];
for (let i = 0; i < 24; i++) made.push({ id: i, ["key" + (i % 6)]: i, label: i % 3 === 0 ? "text" + i : i });

function readAll(title: string): void {
  const seen: string[] = [];
  for (let round = 0; round < 3; round++) for (const named of made) if (round === 2) seen.push(describe(labelOf(named)));
  console.log(title, seen.join(" "));
}

readAll("as made");

for (let i = 0; i < made.length; i += 4) delete made[i].label;
readAll("every fourth deleted");

for (let i = 0; i < made.length; i += 4) made[i].label = i * 0.5;
readAll("put back behind the other keys");

for (let i = 1; i < made.length; i += 4) Object.defineProperty(made[i], "label", { get: () => "computed" + i, configurable: true, enumerable: true });
readAll("every fourth computed");

for (let i = 2; i < made.length; i += 4) made[i]["more" + i] = true;
readAll("a key more on every fourth");

for (let i = 3; i < made.length; i += 4) made[i].label = { toString: () => "object" + i };
readAll("objects");

for (let i = 3; i < made.length; i += 4) made[i].label = null;
readAll("null");

for (const named of made) for (let k = 0; k < 70; k++) named["many" + k] = k;
readAll("seventy keys more");

for (const named of made) Object.freeze(named);
readAll("frozen");

class Holder {
  id = 0;
}
type Labelled = Holder & { label: number };
function numberOf(holder: Labelled): number {
  return holder.label + 1;
}
const holders: Labelled[] = [];
for (let i = 0; i < 12; i++) {
  const holder = new Holder() as Labelled & Record<string, number>;
  holder["before" + (i % 4)] = i;
  holder.label = i;
  holders.push(holder);
}
let sum = 0;
for (let round = 0; round < 4; round++) for (const holder of holders) sum += numberOf(holder);
console.log("instances", sum);
for (let i = 0; i < holders.length; i += 3) holders[i].label = i + 0.25;
sum = 0;
for (let round = 0; round < 4; round++) for (const holder of holders) sum += numberOf(holder);
console.log("instances, fractions", sum);
