const count = globalThis.aotOperationCount ?? (() => 0);
const counts = typeof globalThis.aotOperationCount === "function";

function match(text, pattern) {
  return text.match(pattern);
}
function show(value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `${JSON.stringify(value)} index ${value.index} input ${JSON.stringify(value.input)} groups ${JSON.stringify(value.groups)}`;
  return typeof value + " " + String(value);
}
function attempt(text, pattern) {
  try {
    return show(match(text, pattern));
  } catch (error) {
    return error.name;
  }
}
function legacy() {
  return [RegExp.lastMatch, RegExp.$1, RegExp.$2, RegExp.leftContext.length, RegExp.rightContext.length].join("|");
}

const route = /^\/users\/([^/]+)\/posts\/([^/]+)$|^\/about()$/;
const paths = ["/users/12/posts/345", "/about", "/users//posts/1", "/nothing", "", "/users/\u4e2d\u6587/posts/\u03c0", "/USERS/1/posts/2"];
for (const path of paths) console.log(JSON.stringify(path), attempt(path, route), legacy());
const url = "https://example.com/users/7/posts/89?x=1";
console.log(attempt(url.slice(19, 36), route), attempt(url.slice(19, 30) + url.slice(30, 36), route), legacy());

const global = /\d+/g, sticky = /\/[a-z]+/y, both = /\d/gy, named = /(?<first>\d)(?<rest>\d*)/, indices = /(\d)/d, unicode = /\p{L}+/u;
for (const pattern of [global, sticky, both, named, indices, unicode]) {
  pattern.lastIndex = 1;
  console.log(String(pattern), attempt("/users/12/posts/345", pattern), pattern.lastIndex, attempt("none", pattern), pattern.lastIndex, legacy());
}

class Own extends RegExp {}
const withExec = /\d+/;
withExec.exec = function (text) {
  return ["by my own exec", text.length];
};
const withProperty = /\d+/;
withProperty.extra = 1;
const strange = /\d+/;
let conversions = 0;
strange.lastIndex = { valueOf() { conversions++; return 2; } };
const matcher = { [Symbol.match](text) { return "matched by an object: " + text; } };
const patterns = [new Own("\\d+"), withExec, withProperty, strange, matcher, "s.r", "(", undefined, null, 12, {}, [], Symbol.iterator];
for (const pattern of patterns) console.log(attempt("/users/12", pattern), conversions);

const receivers = [12345, true, { match(pattern) { return "my own match " + pattern; } }, ["a1"], new String("boxed 12"), null, undefined, 12n, { match: 7 }];
for (const receiver of receivers) console.log(attempt(receiver, /\d+/));

const before = count("operationAOTStringMatchRegExp");
let total = 0;
for (let turn = 0; turn < 3000; turn++) {
  const found = match(paths[turn % 4], route);
  if (found) total += found.length;
  total += match("a1b22c333", global).length;
}
console.log(total, !counts || count("operationAOTStringMatchRegExp") - before >= 3000 ? "the stub is asked" : "THE STUB IS NOT ASKED");
