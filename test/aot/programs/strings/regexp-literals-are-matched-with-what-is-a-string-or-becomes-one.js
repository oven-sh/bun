// Literals of regular expressions in functions that get strings most of the time, and now and then what has to become a string first, by code that enters the same function again.
const lines = [];

class Location {
  constructor() {
    this.rewrite = undefined;
    this.depth = 0;
    this.parse = ({ pathname, search }, state) => {
      if (!this.rewrite && !/[ \x00-\x1f\x7f\u0080-￿]/.test(pathname)) return { href: pathname + search, state };
      return { href: "encoded " + encodeURI(String(pathname)) + search, state };
    };
    this.first = ({ pathname }) => {
      const found = /([a-z]+)(\d*)/.exec(pathname);
      return found ? found[1] + ":" + found[2] + "@" + found.index : "none";
    };
    this.dashes = ({ pathname }, replacement) => String.prototype.replace.call(pathname, /\/+/g, replacement);
    this.parts = ({ pathname }) => String.prototype.split.call(pathname, /[/.]/).join("|");
    this.all = ({ pathname }) => (String.prototype.match.call(pathname, /[a-z]\d/g) ?? []).join();
  }
}

const location = new Location();
const entersAgain = {
  toString() {
    if (location.depth++ > 2) return "/deep9";
    const inner = [
      location.parse({ pathname: entersAgain, search: "" }, 0).href,
      location.first({ pathname: entersAgain }),
      location.dashes({ pathname: entersAgain }, "-"),
      location.all({ pathname: entersAgain }),
    ];
    return "/in" + inner.join("").length;
  },
};
const pathnames = step => [
  "/a" + step + "/b.c",
  step % 7 === 3 ? step : "//x" + step,
  step % 11 === 5 ? "/café " + step : "/plain",
  step % 13 === 6 ? entersAgain : "/y7//z8",
  step % 17 === 8 ? false : "/n1",
  step % 19 === 9 ? ["/l", step] : "/m2.m3",
];

for (let step = 0; step < 60; step++) {
  for (const pathname of pathnames(step)) {
    location.depth = 0;
    const given = { pathname, search: step % 2 ? "?q" : "" };
    const line = [
      location.parse(given, step).href,
      location.first(given),
      location.dashes(given, "-"),
      location.dashes(given, match => {
        location.depth = 9;
        return "<" + match.length + location.dashes({ pathname: "a//b" }, "+") + ">";
      }),
      location.parts(given),
      location.all(given),
    ];
    if (step % 5 === 0 || typeof pathname !== "string") lines.push(step + " " + line.join(" ; "));
  }
  if (step === 40) location.rewrite = { input: true };
}
console.log(lines.join("\n"));
