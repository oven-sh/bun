const log: string[] = [];

class Notes extends WeakMap<object, string> {
  set(key: object, value: string): this {
    log.push("set " + value);
    return super.set(key, value);
  }
}

class Marks extends WeakSet<object> {
  add(value: object): this {
    log.push("add");
    return super.add(value);
  }
}

const key = {};
console.log(new Notes([[key, "note"]]).get(key) + " " + new Marks([key]).has(key) + " [" + log.join(", ") + "]");

export {};
