// A typed object that carries undeclared keys is written as a plain object of the same content is.
interface Point { x: number; y: number; label?: string }
interface Segment { id: number; from: Point; to: Point; points: Point[]; note: string | null }

let different = 0;
let total = 0;
function check(label: string, typed: unknown, plain: unknown): void {
  const writers: ((value: unknown) => string | undefined)[] = [
    value => JSON.stringify(value),
    value => JSON.stringify({ held: value, list: [value, value] }),
    value => JSON.stringify(value, null, 2),
    value => JSON.stringify(value, ["x", "o", "from", "id"]),
    value => JSON.stringify(value, (key, held) => (key === "o" ? "replaced" : held)),
  ];
  for (const write of writers) {
    total++;
    let [first, second] = ["", ""];
    try {
      first = String(write(typed));
    } catch (error) {
      first = "throws " + (error as Error).name;
    }
    try {
      second = String(write(plain));
    } catch (error) {
      second = "throws " + (error as Error).name;
    }
    if (first !== second && different++ < 5) console.log(label + " DIFFERS\n  " + first + "\n  " + second);
  }
}

const points = ['{"x":1,"y":2}', '{"x":1,"y":2,"o":3}', '{"o":"first","x":1,"p":[1,{"q":null}],"y":2,"label":"l","r":{"s":{"t":true}}}', '{"x":1.5,"y":-0,"o":1e21,"p":-1e-7,"q":123456789012}', '{"x":1,"y":2,"a\\"b":1,"c\\nd":2,"é":3,"日本":4,"":5,"😀":"😀"}', '{"x":1,"y":2,"o":"a\\"b\\n\\u0001é日本"}', '{"x":1,"y":2,"0":"zero","7":"seven","o":1}', '{"x":1,"y":2,"__proto__":{"a":1},"constructor":1}', '{"x":1,"y":2,"toJSON":1}', '{"x":1,"y":2,"o":{"toJSON":2}}', "{" + Array.from({ length: 90 }, (_, at) => `"k${at}":${at}`).join(",") + ',"x":1,"y":2}'];
for (const text of points) {
  for (let round = 0; round < 3; round++) check(text, JSON.parse<Point>(text), JSON.parse(text));
}
for (const from of points.slice(0, 6)) {
  for (const to of points.slice(0, 6)) {
    const text = `{"a":1,"id":1,"from":${from},"b":${to},"to":${to},"points":[${from},${to}],"note":null,"c":[${from}]}`;
    check(text, JSON.parse<Segment>(text), JSON.parse(text));
  }
}

const changes: [string, (value: any) => void][] = [
  ["undefined", value => { value.o = undefined; }],
  ["a function", value => { value.o = () => 1; }],
  ["a symbol", value => { value.o = Symbol("s"); }],
  ["a bigint", value => { value.o = 1n; }],
  ["a date", value => { value.o = new Date(0); }],
  ["a map", value => { value.o = new Map([[1, 2]]); }],
  ["an object with toJSON", value => { value.o = { toJSON: () => "told" }; }],
  ["toJSON of its own", value => { value.toJSON = () => "told"; }],
  ["toJSON that is no function", value => { value.toJSON = 5; }],
  ["a getter", value => { Object.defineProperty(value, "o", { get: () => "got", enumerable: true, configurable: true }); }],
  ["a hidden key", value => { Object.defineProperty(value, "o", { value: 1, enumerable: false, configurable: true }); }],
  ["a symbol key", value => { value[Symbol.for("k")] = 1; }],
  ["itself", value => { value.o = value; }],
  ["a boxed string", value => { value.o = new String("boxed"); }],
  ["NaN", value => { value.o = NaN; value.p = Infinity; }],
  ["a rope", value => { value.o = "left ".repeat(5) + value.x + " right"; }],
  ["gone", value => { delete value.o; }],
  ["a member gone", value => { delete value.label; delete value.o; }],
  ["frozen", value => { Object.freeze(value); }],
  ["another prototype", value => { Object.setPrototypeOf(value, { toJSON: () => "inherited" }); }],
];
for (const [label, change] of changes) {
  for (const text of ['{"x":1,"y":2,"o":3}', '{"n":0,"x":1,"o":3,"label":"l","y":2,"p":4}']) {
    const [typed, plain] = [JSON.parse<Point>(text), JSON.parse(text)];
    change(typed);
    change(plain);
    check(label, typed, plain);
  }
}
console.log(total + " texts, " + different + " differ");
