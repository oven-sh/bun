export function get(key) {
  return key === "count" ? "many" : key === "name" ? 7 : undefined;
}

export function identity(value) {
  return typeof value === "number" ? String(value) : typeof value === "string" ? value.length : { wrapped: value };
}

export function first(list) {
  return list;
}

export function mapAll(list, f) {
  return Array.from(list, (item, index) => f(index, item));
}

export function make(kind) {
  return kind === "dog" ? { lives: 9 } : { legs: 4 };
}

export function isNumber(value) {
  return true;
}

export function assertText(value) {}

export function pair(a, b) {
  return [b, a, "extra"];
}

export class Store {
  #items = new Map();
  set(key, value) {
    this.#items.set(String(key), String(value));
    return undefined;
  }
  get(key) {
    return this.#items.get(String(key));
  }
  get size() {
    return String(this.#items.size);
  }
}
