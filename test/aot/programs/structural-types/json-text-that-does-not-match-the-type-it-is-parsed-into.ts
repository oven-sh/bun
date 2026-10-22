function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Config {
  size: number;
  label: string;
  on: boolean;
  tags: string[];
  inner: { depth: number; note: string };
}

function sizePlusOne(c: Config): number {
  return c.size + 1;
}
function labelLength(c: Config): number {
  return c.label.length;
}
function tagCount(c: Config): number {
  return c.tags.length;
}
function depth(c: Config): number {
  return c.inner.depth;
}
function state(c: Config): string {
  return c.on ? "on" : "off";
}

const texts: [string, string][] = [
  ["exact", '{"size":1,"label":"a","on":true,"tags":["x"],"inner":{"depth":2,"note":"n"}}'],
  ["reordered", '{"inner":{"note":"n","depth":2},"tags":["x"],"on":true,"label":"a","size":1}'],
  ["missing", '{"size":1}'],
  ["empty", "{}"],
  ["extra", '{"before":0,"size":1,"label":"a","middle":[1],"on":true,"tags":[],"inner":{"depth":2,"note":"n","more":1},"after":null}'],
  ["wrong kinds", '{"size":"1","label":2,"on":"yes","tags":"x","inner":5}'],
  ["all null", '{"size":null,"label":null,"on":null,"tags":null,"inner":null}'],
  ["duplicates", '{"size":1,"size":"two","label":"a","label":"b","on":true,"tags":[],"inner":{"depth":1,"note":""}}'],
  ["proto key", '{"__proto__":{"size":9},"label":"a","on":false,"tags":[],"inner":{"depth":1,"note":""}}'],
  ["number keys", '{"2":"two","size":1,"1":"one","label":"a","on":true,"tags":[],"inner":{"depth":1,"note":""}}'],
  ["odd numbers", '{"size":-0,"label":"\\u0061\\n","on":false,"tags":[],"inner":{"depth":1e400,"note":""}}'],
  ["fractions", '{"size":1.5e0,"label":"","on":true,"tags":[],"inner":{"depth":12345678901234567890,"note":""}}'],
  ["mixed tags", '{"size":1,"label":"a","on":true,"tags":["x",1,null,["y"]],"inner":{"depth":2,"note":"n"}}'],
  ["spaces", ' {\\n "size" : 1 ,\\t"label":"a","on":true,"tags":[ ],"inner":{"depth":2,"note":"n"} } '.replaceAll("\\n", "\n").replaceAll("\\t", "\t")],
  ["array", "[1,2]"],
  ["number", "5"],
  ["string", '"text"'],
  ["null", "null"],
  ["cut short", '{"size":1,'],
  ["trailing comma", '{"size":1,}'],
  ["single quotes", "{'size':1}"],
  ["nothing", ""],
];

for (const [name, source] of texts) {
  show(name + " round trip", () => {
    const parsed: Config = JSON.parse(source);
    return JSON.stringify(parsed);
  });
  show(name + " keys", () => {
    const parsed: Config = JSON.parse(source);
    return Object.keys(parsed).join();
  });
  show(name + " kinds", () => {
    const parsed: Config = JSON.parse(source);
    return [typeof parsed.size, typeof parsed.label, typeof parsed.on, typeof parsed.tags, typeof parsed.inner].join();
  });
  show(name + " size + 1", () => sizePlusOne(JSON.parse(source)));
  show(name + " label length", () => labelLength(JSON.parse(source)));
  show(name + " tag count", () => tagCount(JSON.parse(source)));
  show(name + " depth", () => depth(JSON.parse(source)));
  show(name + " state", () => state(JSON.parse(source)));
}
show("-0 stays -0", () => {
  const parsed: Config = JSON.parse('{"size":-0}');
  return Object.is(parsed.size, -0);
});
show("the proto key is an own property", () => {
  const parsed: Config = JSON.parse('{"__proto__":{"size":9}}');
  return Object.hasOwn(parsed, "__proto__") + " " + parsed.size;
});
