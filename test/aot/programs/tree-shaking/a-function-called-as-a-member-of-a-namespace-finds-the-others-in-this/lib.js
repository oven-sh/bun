export function start() {
  return "start, " + this.second();
}
export function second() {
  return "second";
}
export function startByName(name) {
  return "start by name, " + this[name]();
}
export function third() {
  return "third";
}
