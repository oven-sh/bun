// `(value as Row).name`, where nothing is known of the value: any object passes the cast and stays what it is, and a primitive throws. The read through the cast is a typed read: a property of another kind throws, a missing one is undefined.
interface Row {
  name: string;
  n: number;
}
interface Order {
  id: number;
  row: Row;
}
const rows: Row[] = [
  { name: "Ada", n: 1 },
  { name: "Bo", n: 2 },
];
function label(row: Row): string {
  return row.name + ":" + row.n;
}
const hidden = (value: unknown): unknown => value;

console.log((hidden(rows[0]) as Row).name, (hidden(rows[0]) as Row).n + 1, label(rows[0]!));
const loose: any = { name: "loose", n: "3" };
try {
  console.log((loose as Row).name, (loose as Row).n + 1, typeof (loose as Row).n);
} catch (error) {
  console.log("a text where the type says number:", (error as Error).constructor.name);
}
try {
  console.log((hidden({ id: 1, row: { name: "inner", n: 4 } }) as Order).row.name, (hidden({ id: 1, row: 5 }) as Order).row.name);
} catch (error) {
  console.log("a number where the type says Row:", (error as Error).constructor.name);
}
try {
  console.log((hidden({}) as Row).name, (hidden([]) as Row).name, (hidden(() => 1) as Row).name, (hidden(5) as Row).name, (hidden("text") as Row).n);
} catch (error) {
  console.log("a number under the cast:", (error as Error).constructor.name);
}
for (const nothing of [undefined, null]) {
  try {
    console.log((hidden(nothing) as Row).name);
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
try {
  throw rows[1];
} catch (error) {
  console.log((error as Row).name, (error as Row) === rows[1]);
}
console.log(Array.prototype.map.call(rows, row => (row as Row).name).join());
console.log((hidden({ get name() { return "computed"; } }) as Row).name, (hidden(Object.create({ name: "inherited" })) as Row).name);
console.log((hidden(rows[0]) as Row)["name"], (hidden(rows[1])! as Row).n);
let total = 0;
for (const row of rows) total += row.n + (hidden(row) as Row).n;
console.log(total);
