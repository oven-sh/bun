// Outside strict mode the text of a direct eval declares variables and functions of the function around it. They hold, or call, functions of the module that only the text names.
function target() {
  return "target";
}
function other() {
  return "other";
}

function run() {
  eval("var copy = target; function wrapper() { return other(); }");
  return copy() + ", " + wrapper();
}
console.log(run());

eval("var atTopLevel = target");
console.log(atTopLevel());
