// Prints marker lines, which start with "|". The indent of a marker line is the
// group depth at that point. Node prints the same marker lines.

const custom = Symbol.for("nodejs.util.inspect.custom");
const throws = () => {
  throw new Error("label throws");
};
// Node reads `size` only when the Map has an entry.
class SizeThrows extends Map {
  get size() {
    return throws();
  }
}
const labels = {
  "inspect.custom": [{ [custom]: throws }],
  "text and inspect.custom": ["text", { [custom]: throws }],
  "%s toString": ["%s", { toString: throws }],
  "%j toJSON": ["%j", { toJSON: throws }],
  "%j BigInt": ["%j", 1n],
  // The error printer leaves the exception pending and reports success to its caller.
  "Error property": [Object.assign(new Error("label"), { map: new SizeThrows([[1, 2]]) })],
};

// A label that throws can leave the start of its line on stdout. The empty line ends it.
function mark(text) {
  console.log();
  console.log("|" + text);
}

function start(method, name, ...label) {
  try {
    console[method](...label);
    mark(`${method}(${name}) returns`);
  } catch (e) {
    mark(`${method}(${name}) throws ${e.constructor.name}`);
  }
}

function startWithEachLabel() {
  for (const method of ["group", "groupCollapsed"]) {
    for (const name in labels) start(method, name, ...labels[name]);
  }
}

startWithEachLabel();

console.group("|outer");
startWithEachLabel();
console.error("|stderr in outer");
console.group("|inner");
mark("in inner");
console.groupEnd();
mark("in outer");
console.groupEnd();
mark("after outer");
console.error("|stderr after outer");

const returnsText = () => "label";
const startsGroup = then => ({
  [custom]() {
    console.group("|started by a label");
    return then();
  },
});
start("group", "starts a group, then throws", startsGroup(throws));
console.groupEnd();
mark("after groupEnd");
start("group", "starts a group, then returns", startsGroup(returnsText));
console.groupEnd();
console.groupEnd();
mark("after groupEnd, groupEnd");

start("group", "no label");
console.groupEnd();
start("groupCollapsed", "no label");
console.groupEnd();
mark("end");
