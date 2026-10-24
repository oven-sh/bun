interface Reading {
  count: number;
  label: string;
  ok: boolean;
  inner: { depth: number };
  list: number[];
}

function attempt(label: string, body: () => unknown): void {
  try {
    const value = body();
    console.log(label + ": " + typeof value + " " + String(value));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function parse(text: string): Reading {
  const r: Reading = JSON.parse(text);
  return r;
}

function countPlusOne(r: Reading): number {
  return r.count + 1;
}

function labelLength(r: Reading): number {
  return r.label.length;
}

function depth(r: Reading): number {
  return r.inner.depth;
}

function total(r: Reading): number {
  let sum = 0;
  for (const n of r.list) sum += n;
  return sum;
}

function choose(r: Reading): string {
  return r.ok ? "yes" : "no";
}

const honest = '{"count":1,"label":"l","ok":true,"inner":{"depth":2},"list":[1,2]}';

function withMember(name: string, json: string): string {
  const whole: Record<string, unknown> = JSON.parse(honest);
  const parts: string[] = [];
  for (const key of Object.keys(whole)) parts.push(JSON.stringify(key) + ":" + (key === name ? json : JSON.stringify(whole[key])));
  return "{" + parts.join(",") + "}";
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const r = parse(honest);
  warm += countPlusOne(r) + labelLength(r) + depth(r) + total(r) + choose(r).length;
}
console.log("2000 honest: " + warm);

const values = ["1", "1.5", '"text"', '"12"', "true", "false", "null", "[]", "[3]", "{}", '{"depth":"deep"}', '{"length":2}', '["a","b"]'];

for (const value of values) {
  attempt("count is " + value + ", itself", () => parse(withMember("count", value)).count);
  attempt("count is " + value + ", plus one", () => countPlusOne(parse(withMember("count", value))));
  attempt("label is " + value + ", itself", () => parse(withMember("label", value)).label);
  attempt("label is " + value + ", its length", () => labelLength(parse(withMember("label", value))));
  attempt("ok is " + value + ", chosen", () => choose(parse(withMember("ok", value))));
  attempt("inner is " + value + ", its depth", () => depth(parse(withMember("inner", value))));
  attempt("list is " + value + ", summed", () => total(parse(withMember("list", value))));
  attempt("every member is kept as it is, " + value, () => JSON.stringify(parse(withMember("count", value))) === withMember("count", value));
}

for (const whole of ["null", "1", '"text"', "true", "[]", '[{"count":1}]']) {
  attempt("the whole text is " + whole + ", typeof", () => typeof parse(whole));
  attempt("the whole text is " + whole + ", a member", () => parse(whole).count);
  attempt("the whole text is " + whole + ", plus one", () => countPlusOne(parse(whole)));
}

export {};
