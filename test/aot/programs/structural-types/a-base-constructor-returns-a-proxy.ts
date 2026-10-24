function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

const seen: string[] = [];

class Watched {
  constructor() {
    return new Proxy(this, {
      defineProperty(target, key, descriptor) {
        seen.push("define " + String(key));
        return Reflect.defineProperty(target, key, descriptor);
      },
      set(target, key, value, receiver) {
        seen.push("set " + String(key));
        return Reflect.set(target, key, value, receiver);
      },
      get(target, key, receiver) {
        if (typeof key === "string") seen.push("get " + key);
        return Reflect.get(target, key, receiver);
      },
    });
  }
}

class Derived extends Watched {
  first = 1;
  second: number;
  constructor() {
    super();
    this.second = this.first + 1;
  }
}

const made = new Derived();
console.log("traps while constructing: " + seen.join(", "));
seen.length = 0;
console.log("members: " + made.first + " " + made.second);
console.log("traps while reading: " + seen.join(", "));
console.log("instance: " + (made instanceof Derived));
console.log(describe(made));
