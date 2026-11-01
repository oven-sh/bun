// Prints through every console method that prints, except a console.assert
// that fails. `process.argv[2]` is the number of groups to open first, so that
// every run has the same line numbers.
const depth = Number(process.argv[2]);
for (let i = 0; i < depth; i++) console.group();

console.log("log");
console.info("info");
console.debug("debug");
console.warn("warn");
console.error("error");

console.log();
console.info();
console.debug();
console.warn();
console.error();

console.count();
console.count("count");
console.count("count");
console.count("count\nwith a line feed");

console.time("timer");
console.timeLog("timer");
console.timeLog("timer", "data", { a: 1, b: { c: 2 } }, "more\ndata");
console.timeEnd("timer");
console.time();
console.timeLog();
console.timeEnd();
console.time("timer\nwith a line feed");
console.timeLog("timer\nwith a line feed");
console.timeEnd("timer\nwith a line feed");

console.table([
  { a: 1, b: "x" },
  { a: 2, b: "y" },
]);
console.table("not tabular");

console.dir({ a: 1, b: { c: 2 } });
console.dirxml({ a: 1 }, "dirxml");

console.log("two\nlines");
console.log("%s and %o", "format\nstring", { a: 1 });
console.log("ends with a line feed\n");
console.log("a\n\nb");
console.log("crlf\r\nline");
console.log({ a: { b: { c: {} } }, s: "a\nb", arr: [1, 2, 3] });
console.log(Array.from({ length: 100 }, (_, i) => i));
console.log(Symbol("symbol\ndescription"));
console.log({ [Symbol.for("nodejs.util.inspect.custom")]: () => "custom\ninspect" });
console.log(new Map([["key", { a: 1 }]]), new Set([1, 2]));
console.log(new Date(0));
console.log(new Error("log an error"));
console.warn(new Error("warn an error"));
console.error(new Error("error an error"));

console.trace();
console.trace("trace %s", "data");

console.group("group label");
console.log("in a group");
console.groupCollapsed("collapsed\nlabel");
console.warn("in a collapsed group");
console.groupEnd();
console.groupEnd();

console.log("done");
