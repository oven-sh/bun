// The branch depends on a binding that looks like a constant false: a let that is stored to later, a var that a function changes, a const read from an object that changes, an enum member that is computed, a const in its dead zone behind a typeof guard.
const log: string[] = [];
function afterLet() { log.push("let"); } function afterVar() { log.push("var"); } function afterMember() { log.push("member"); }
function afterEnum() { log.push("enum"); } function afterParameter() { log.push("parameter"); } function afterExportedLet() { log.push("exported let"); }

let flag = false;
function check() {
  if (flag) afterLet();
}
check();
flag = true;
check();

var switched = false;
function flip() {
  switched = !switched;
}
flip();
if (switched) afterVar();

const settings = { on: false };
Object.assign(settings, { on: true });
if (settings.on) afterMember();

enum Mode {
  Off = 0,
  On = "x".length,
}
if (Mode.On) afterEnum();

function withDefault(enabled = false) {
  if (enabled) afterParameter();
}
withDefault(true);

export let exported = false;
export function enable() {
  exported = true;
}
enable();
if (exported) afterExportedLet();

console.log(log.join(", "));
