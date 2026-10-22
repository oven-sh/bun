let last = null;
const registry = new Set();

export function makePoint() {
  last = { x: 1, y: 2 };
  return last;
}

export function makeWide() {
  last = { z: 3, y: 2, x: 1 };
  return last;
}

export function makeList() {
  last = [1, 2];
  return last;
}

export function makeLine() {
  const p = { x: 1, y: 2 };
  last = { from: p, to: p };
  return last;
}

export function isLast(value) {
  return value === last;
}

export function lastAsText() {
  return JSON.stringify(last) + Object.keys(last).join();
}

export function changeLast() {
  if (Array.isArray(last)) last.push(100);
  else last.x = 100;
}

export function identity(value) {
  return value;
}

export function remember(value) {
  registry.add(value);
}

export function remembers(value) {
  return registry.has(value);
}

export function scribble(value) {
  value.x = 50;
  value.note = "scribbled";
}

export class Tracked {
  static all = [];
  #secret = 7;
  constructor(name) {
    this.name = name;
    Tracked.all.push(this);
  }
  secret() {
    return this.#secret;
  }
  isFirst() {
    return Tracked.all[0] === this;
  }
}
