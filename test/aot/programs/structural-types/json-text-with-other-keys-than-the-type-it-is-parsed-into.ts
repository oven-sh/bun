interface Point {
  x: number;
  y: number;
}

interface Box {
  name: string;
  origin: Point;
  corners: Point[];
  note?: string;
}

class Pair {
  x = 0;
  y = 0;
  sum(): number {
    return this.x + this.y;
  }
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function parsePoint(text: string): Point {
  const p: Point = JSON.parse(text);
  return p;
}

function parseBox(text: string): Box {
  const b: Box = JSON.parse(text);
  return b;
}

function parsePoints(text: string): Point[] {
  const list: Point[] = JSON.parse(text);
  return list;
}

function parsePair(text: string): Pair {
  const p: Pair = JSON.parse(text);
  return p;
}

function facts(p: Point): string {
  let walked = "";
  for (const key in p) walked += key + ",";
  return [
    "x " + p.x,
    "y " + p.y,
    "sum " + (p.x + p.y),
    "keys " + Object.keys(p).join(),
    "for-in " + walked,
    "json " + JSON.stringify(p),
    "spread " + JSON.stringify({ ...p }),
    "has " + ("x" in p) + ("y" in p),
    "plain " + (Object.getPrototypeOf(p) === Object.prototype),
  ].join("; ");
}

const texts: [string, string][] = [
  ["as declared", '{"x":1,"y":2}'],
  ["other order", '{"y":2,"x":1}'],
  ["an extra in front", '{"w":0,"x":1,"y":2}'],
  ["an extra between", '{"x":1,"w":0,"y":2}'],
  ["an extra behind", '{"x":1,"y":2,"w":0}'],
  ["many extras", '{"a":1,"b":2,"c":3,"d":4,"y":2,"e":5,"f":6,"g":7,"x":1,"h":8}'],
  ["y is missing", '{"x":1}'],
  ["both are missing", "{}"],
  ["x twice", '{"x":1,"y":2,"x":3}'],
  ["x twice, around y", '{"x":1,"y":2,"x":3,"y":4}'],
  ["index keys", '{"x":1,"1":"one","y":2,"0":"zero"}'],
  ["a key named __proto__", '{"x":1,"__proto__":{"y":5}}'],
  ["escaped names", '{"\\u0078":1,"\\u0079":2}'],
  ["an empty name", '{"":0,"x":1,"y":2}'],
  ["white space", ' \n{ "x" :\t1 , "y" : 2 }\r\n'],
  ["an extra that is an object", '{"x":1,"extra":{"x":9,"y":9},"y":2}'],
  ["fractions and exponents", '{"x":1.5e2,"y":-0.25}'],
  ["minus zero", '{"x":-0,"y":0}'],
  ["too large for a number", '{"x":1e400,"y":-1e400}'],
  ["more digits than a number holds", '{"x":9007199254740993,"y":0.1000000000000000055511151231257827}'],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += parsePoint('{"x":1,"y":2}').x + parsePoint('{"x":3,"y":4}').y;
console.log("2000 as declared: " + warm);

for (const [label, text] of texts) attempt(label, () => facts(parsePoint(text)));
attempt("minus zero stays", () => Object.is(parsePoint('{"x":-0,"y":0}').x, -0));

for (const bad of ["", "{", '{"x":1,}', "{'x':1}", '{"x":01}', '{"x":1}}', '{"x":NaN}', "undefined", '{"x":1 "y":2}']) {
  attempt("not json " + JSON.stringify(bad), () => facts(parsePoint(bad)));
}

const boxes: [string, string][] = [
  ["as declared", '{"name":"b","origin":{"x":1,"y":2},"corners":[{"x":3,"y":4}]}'],
  ["everything backwards", '{"note":"n","corners":[{"y":4,"x":3},{"x":5,"z":0,"y":6}],"origin":{"y":2,"x":1},"name":"b"}'],
  ["extras at every level", '{"id":7,"name":"b","origin":{"x":1,"y":2,"z":3},"corners":[],"more":[1,{"a":2}]}'],
  ["no corners", '{"name":"b","origin":{"x":1,"y":2}}'],
];
for (const [label, text] of boxes) {
  attempt("box, " + label + ", round trip", () => JSON.stringify(parseBox(text)));
  attempt("box, " + label + ", keys", () => Object.keys(parseBox(text)).join() + " / " + Object.keys(parseBox(text).origin).join());
  attempt("box, " + label + ", reads", () => parseBox(text).origin.x + parseBox(text).corners.length + (parseBox(text).note ?? "-"));
}

attempt("a list", () => parsePoints('[{"x":1,"y":2},{"y":4,"x":3},{"x":5,"y":6,"z":7}]').map(p => Object.keys(p).join("")).join());
attempt("a list, summed", () => parsePoints('[{"x":1,"y":2},{"y":4,"x":3},{"x":5}]').reduce((sum, p) => sum + p.x + p.y, 0));

attempt("into a class type, members", () => parsePair('{"x":1,"y":2}').x + " " + (parsePair('{"x":1,"y":2}') instanceof Pair));
attempt("into a class type, a method", () => parsePair('{"x":1,"y":2}').sum());
attempt("into a class type, a text with the method's name", () => typeof parsePair('{"x":1,"y":2,"sum":3}').sum);

export {};
