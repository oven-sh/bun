function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Indexed {
  0: string;
  1: string;
  name: string;
}
interface Quoted {
  "10": number;
  "9": number;
  "01": number;
  "-1": number;
  "1.5": number;
  "4294967295": number;
  "4294967294": number;
}
type Table = Record<string, number>;

function first(indexed: Indexed): string {
  return indexed[0] + indexed[1] + indexed.name;
}
function total(table: Table): number {
  let sum = 0;
  for (const key in table) sum += table[key];
  return sum;
}

attempt("declared indexes", () => {
  const indexed = JSON.parse<Indexed>('{"name":"n","1":"b","0":"a"}');
  return [indexed, Object.keys(indexed), first(indexed), JSON.stringify(indexed), Array.isArray(indexed)];
});
attempt("declared indexes and more", () => {
  const indexed = JSON.parse<Indexed>('{"5":"f","name":"n","1":"b","x":1,"0":"a","3":"d"}');
  return [indexed, Object.keys(indexed), first(indexed)];
});
attempt("quoted names", () => {
  const quoted = JSON.parse<Quoted>('{"10":1,"9":2,"01":3,"-1":4,"1.5":5,"4294967295":6,"4294967294":7}');
  return [quoted, Object.keys(quoted), quoted[10] + quoted[9], quoted["01"], quoted["-1"], quoted["1.5"], quoted[4294967295], quoted[4294967294]];
});
attempt("a table", () => {
  const table = JSON.parse<Table>('{"b":1,"2":2,"a":3,"1":4,"-0":5,"0":6,"1e3":7,"1000":8,"":9," 1":10}');
  return [table, Object.keys(table), total(table), table[0], table["-0"], table[1000], table["1e3"], table[""]];
});
attempt("a table with very many indexes", () => {
  let text = "{";
  for (let i = 2000; i > 0; i--) text += '"' + i + '":' + i + ",";
  const table = JSON.parse<Table>(text + '"0":0}');
  const keys = Object.keys(table);
  return [keys.length, keys[0], keys[1], keys[2000], total(table)];
});
attempt("a sparse table", () => {
  const table = JSON.parse<Table>('{"1000000":1,"5":2,"4000000000":3}');
  return [table, Object.keys(table), total(table)];
});
