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

enum Color {
  Red,
  Green,
}

function sum(list: number[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}
function joined(list: string[]): string {
  let text = "";
  for (const part of list) text += part.toUpperCase();
  return text;
}
function swap(pair: [number, string]): string {
  return pair[1].length + ":" + (pair[0] + 1) + ":" + pair.length;
}
function count(table: Record<string, number>): number {
  let total = 0;
  for (const key in table) total += table[key];
  return total;
}
function nameOf(color: Color): string {
  switch (color) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum([i, 1]) + joined(["a"]).length + swap([i, "s"]).length + count({ a: i }) + nameOf(i % 2).length;
console.log("2000 honest rounds", warm);

for (const text of ["[1,2,3]", "[1,2.5,-0]", '[1,"2",3]', "[1,null,3]", "[1,[2],3]", "[true,false]", '[{"valueOf":1}]', "[]", "{}", '{"length":2,"0":5,"1":6}', '"123"', "5", "null"]) {
  attempt(text + " as numbers", () => {
    const list: number[] = JSON.parse(text);
    return sum(list);
  });
}
for (const text of ['["a","b"]', '["a",1]', '["a",null]', '[["a"]]', '"ab"', "{}", "null"]) {
  attempt(text + " as texts", () => {
    const list: string[] = JSON.parse(text);
    return joined(list);
  });
}
for (const text of ['[1,"a"]', '["a",1]', "[1]", "[]", '[1,"a",2,"b"]', '[null,"a"]', '[1,null]', '{"0":1,"1":"a","length":2}', "null"]) {
  attempt(text + " as a pair", () => {
    const pair: [number, string] = JSON.parse(text);
    return swap(pair);
  });
}
for (const text of ['{"a":1,"b":2}', '{"a":"1","b":2}', '{"a":null}', '{"a":[1]}', '{"__proto__":{"c":3},"a":1}', "[1,2]", '"ab"', "3", "null"]) {
  attempt(text + " as a table", () => {
    const table: Record<string, number> = JSON.parse(text);
    return count(table);
  });
}
for (const text of ["0", "1", "2", "-0", "0.5", '"0"', '"Red"', "null", "[0]", "true"]) {
  attempt(text + " as a color", () => {
    const color: Color = JSON.parse(text);
    return [nameOf(color), typeof nameOf(color), Color[color], color === Color.Red];
  });
}
