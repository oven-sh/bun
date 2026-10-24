class Point {
  x = 3;
  norm(): string {
    return "method " + this.x;
  }
  tag(strings: TemplateStringsArray, value: number): string {
    return "tag method " + strings.join("_") + " " + value + " " + this.x;
  }
}

const key: "norm" = ["no", "rm"].join("") === "norm" ? "norm" : "norm";

const ways: [string, (p: Point) => string][] = [
  ["a plain call", p => p.norm()],
  ["an optional receiver", p => p?.norm()],
  ["an optional call", p => p.norm?.()],
  ["brackets", p => p["norm"]()],
  ["a computed name", p => p[key]()],
  ["parentheses", p => (p.norm)()],
  ["call", p => p.norm.call(p)],
  ["apply", p => p.norm.apply(p, [])],
  ["Reflect.apply", p => Reflect.apply(p.norm, p, [])],
  ["bind", p => p.norm.bind(p)()],
  [
    "taken out by a pattern",
    p => {
      const { norm } = p;
      return norm.call(p);
    },
  ],
  [
    "kept in a variable",
    p => {
      const f = p.norm;
      return f.call(p);
    },
  ],
  ["handed to map with a this", p => [0].map(p.norm, p).join()],
  ["the prototype's, called for it", p => Point.prototype.norm.call(p)],
  ["Reflect.get and call", p => String(Reflect.get(p, "norm").call(p))],
  ["a tagged template", p => p.tag`a${1}b`],
  ["in a template", p => `${p.norm()}`],
  ["in a condition", p => (p.norm() ? p.norm() : "never")],
  ["after a comma", p => (p.x, p.norm())],
  ["as an argument", p => String(p.norm())],
  ["spread arguments", p => p.norm(...[])],
];

function round(label: string, p: Point): void {
  for (const [name, run] of ways) {
    try {
      console.log(label + ", " + name + ": " + run(p));
    } catch (error) {
      console.log(label + ", " + name + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
    }
  }
}

const p = new Point();
let warm = 0;
for (let i = 0; i < 2000; i++) for (const [, run] of ways) warm += run(p).length;
console.log("2000 honest: " + warm);
round("before", p);

p.norm = function () {
  return "own " + this.x;
};
p.tag = (strings, value) => "own tag " + strings.length + " " + value;
round("an own member", p);

Reflect.deleteProperty(p, "norm");
Reflect.deleteProperty(p, "tag");
const norm = Point.prototype.norm;
const tag = Point.prototype.tag;
Point.prototype.norm = function () {
  return "patched " + this.x;
};
Point.prototype.tag = function (strings, value) {
  return "patched tag " + strings.raw.join("_") + " " + value + " " + this.x;
};
round("the prototype", p);

Point.prototype.norm = norm;
Point.prototype.tag = tag;
round("restored", p);

export {};
