const kept = new Map();

export function same(value) {
  return value;
}

export function pick(object, name) {
  return object[name];
}

export function keep(name, value) {
  kept.set(name, value);
}

export function kept_(name) {
  return kept.get(name);
}

export function call(f, ...operands) {
  return f(...operands);
}

export function callOn(receiver, f, ...operands) {
  return f.apply(receiver, operands);
}

export function each(list, f) {
  const results = [];
  for (const item of list) results.push(f(item));
  return results;
}

export class Bag {
  constructor(content) {
    this.content = content;
  }
  get() {
    return this.content;
  }
}

export function spoil(object, name, value) {
  object[name] = value;
  return object;
}
