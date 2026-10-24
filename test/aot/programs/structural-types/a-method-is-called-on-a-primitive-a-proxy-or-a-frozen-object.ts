class Owner {
  first: string = "ann";
}

class Subject {
  count: number = 10;
  label: string = "subject";
  owner: Owner = new Owner();
  action: () => number = () => 7;
  #secret: number = 42;
  readCount(): number {
    return this.count;
  }
  countPlusOne(): number {
    return this.count + 1;
  }
  readLabel(): string {
    return this.label;
  }
  labelLength(): number {
    return this.label.length;
  }
  ownerName(): string {
    return this.owner.first;
  }
  runAction(): number {
    return this.action();
  }
  readSecret(): number {
    return this.#secret;
  }
  storeCount(): number {
    this.count = 99;
    return this.count;
  }
  bump(): number {
    return ++this.count;
  }
  storeLabel(): string {
    this.label = "stored";
    return this.label;
  }
  callsOther(): number {
    return this.readCount() * 2;
  }
  kind(): string {
    return typeof this;
  }
}

function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

const s = new Subject();
const log: string[] = [];
const list = [1, 2];
function plain(): number {
  return 0;
}
const proxied = new Proxy(new Subject(), {
  get(target, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    log.push("set " + String(key));
    return Reflect.set(target, key, value, receiver);
  },
});
const frozen = Object.freeze(new Subject());
const bare: object = Object.create(null);
const inherits: object = Object.create(new Subject());

show("undefined readCount", () => s.readCount.call(undefined));
show("undefined countPlusOne", () => s.countPlusOne.call(undefined));
show("undefined readLabel", () => s.readLabel.call(undefined));
show("undefined labelLength", () => s.labelLength.call(undefined));
show("undefined ownerName", () => s.ownerName.call(undefined));
show("undefined runAction", () => s.runAction.call(undefined));
show("undefined readSecret", () => s.readSecret.call(undefined));
show("undefined storeCount", () => s.storeCount.call(undefined));
show("undefined bump", () => s.bump.call(undefined));
show("undefined storeLabel", () => s.storeLabel.call(undefined));
show("undefined callsOther", () => s.callsOther.call(undefined));
show("undefined kind", () => s.kind.call(undefined));
show("null readCount", () => s.readCount.call(null));
show("null countPlusOne", () => s.countPlusOne.call(null));
show("null readLabel", () => s.readLabel.call(null));
show("null labelLength", () => s.labelLength.call(null));
show("null ownerName", () => s.ownerName.call(null));
show("null runAction", () => s.runAction.call(null));
show("null readSecret", () => s.readSecret.call(null));
show("null storeCount", () => s.storeCount.call(null));
show("null bump", () => s.bump.call(null));
show("null storeLabel", () => s.storeLabel.call(null));
show("null callsOther", () => s.callsOther.call(null));
show("null kind", () => s.kind.call(null));
show("a number readCount", () => s.readCount.call(5));
show("a number countPlusOne", () => s.countPlusOne.call(5));
show("a number readLabel", () => s.readLabel.call(5));
show("a number labelLength", () => s.labelLength.call(5));
show("a number ownerName", () => s.ownerName.call(5));
show("a number runAction", () => s.runAction.call(5));
show("a number readSecret", () => s.readSecret.call(5));
show("a number storeCount", () => s.storeCount.call(5));
show("a number bump", () => s.bump.call(5));
show("a number storeLabel", () => s.storeLabel.call(5));
show("a number callsOther", () => s.callsOther.call(5));
show("a number kind", () => s.kind.call(5));
show("a string readCount", () => s.readCount.call("text"));
show("a string countPlusOne", () => s.countPlusOne.call("text"));
show("a string readLabel", () => s.readLabel.call("text"));
show("a string labelLength", () => s.labelLength.call("text"));
show("a string ownerName", () => s.ownerName.call("text"));
show("a string runAction", () => s.runAction.call("text"));
show("a string readSecret", () => s.readSecret.call("text"));
show("a string storeCount", () => s.storeCount.call("text"));
show("a string bump", () => s.bump.call("text"));
show("a string storeLabel", () => s.storeLabel.call("text"));
show("a string callsOther", () => s.callsOther.call("text"));
show("a string kind", () => s.kind.call("text"));
show("true readCount", () => s.readCount.call(true));
show("true countPlusOne", () => s.countPlusOne.call(true));
show("true readLabel", () => s.readLabel.call(true));
show("true labelLength", () => s.labelLength.call(true));
show("true ownerName", () => s.ownerName.call(true));
show("true runAction", () => s.runAction.call(true));
show("true readSecret", () => s.readSecret.call(true));
show("true storeCount", () => s.storeCount.call(true));
show("true bump", () => s.bump.call(true));
show("true storeLabel", () => s.storeLabel.call(true));
show("true callsOther", () => s.callsOther.call(true));
show("true kind", () => s.kind.call(true));
show("an array readCount", () => s.readCount.call(list));
show("an array countPlusOne", () => s.countPlusOne.call(list));
show("an array readLabel", () => s.readLabel.call(list));
show("an array labelLength", () => s.labelLength.call(list));
show("an array ownerName", () => s.ownerName.call(list));
show("an array runAction", () => s.runAction.call(list));
show("an array readSecret", () => s.readSecret.call(list));
show("an array storeCount", () => s.storeCount.call(list));
show("an array bump", () => s.bump.call(list));
show("an array storeLabel", () => s.storeLabel.call(list));
show("an array callsOther", () => s.callsOther.call(list));
show("an array kind", () => s.kind.call(list));
show("a function readCount", () => s.readCount.call(plain));
show("a function countPlusOne", () => s.countPlusOne.call(plain));
show("a function readLabel", () => s.readLabel.call(plain));
show("a function labelLength", () => s.labelLength.call(plain));
show("a function ownerName", () => s.ownerName.call(plain));
show("a function runAction", () => s.runAction.call(plain));
show("a function readSecret", () => s.readSecret.call(plain));
show("a function storeCount", () => s.storeCount.call(plain));
show("a function bump", () => s.bump.call(plain));
show("a function storeLabel", () => s.storeLabel.call(plain));
show("a function callsOther", () => s.callsOther.call(plain));
show("a function kind", () => s.kind.call(plain));
show("a proxy readCount", () => s.readCount.call(proxied));
show("a proxy countPlusOne", () => s.countPlusOne.call(proxied));
show("a proxy readLabel", () => s.readLabel.call(proxied));
show("a proxy labelLength", () => s.labelLength.call(proxied));
show("a proxy ownerName", () => s.ownerName.call(proxied));
show("a proxy runAction", () => s.runAction.call(proxied));
show("a proxy readSecret", () => s.readSecret.call(proxied));
show("a proxy storeCount", () => s.storeCount.call(proxied));
show("a proxy bump", () => s.bump.call(proxied));
show("a proxy storeLabel", () => s.storeLabel.call(proxied));
show("a proxy callsOther", () => s.callsOther.call(proxied));
show("a proxy kind", () => s.kind.call(proxied));
show("frozen readCount", () => s.readCount.call(frozen));
show("frozen countPlusOne", () => s.countPlusOne.call(frozen));
show("frozen readLabel", () => s.readLabel.call(frozen));
show("frozen labelLength", () => s.labelLength.call(frozen));
show("frozen ownerName", () => s.ownerName.call(frozen));
show("frozen runAction", () => s.runAction.call(frozen));
show("frozen readSecret", () => s.readSecret.call(frozen));
show("frozen storeCount", () => s.storeCount.call(frozen));
show("frozen bump", () => s.bump.call(frozen));
show("frozen storeLabel", () => s.storeLabel.call(frozen));
show("frozen callsOther", () => s.callsOther.call(frozen));
show("frozen kind", () => s.kind.call(frozen));
show("no prototype readCount", () => s.readCount.call(bare));
show("no prototype countPlusOne", () => s.countPlusOne.call(bare));
show("no prototype readLabel", () => s.readLabel.call(bare));
show("no prototype labelLength", () => s.labelLength.call(bare));
show("no prototype ownerName", () => s.ownerName.call(bare));
show("no prototype runAction", () => s.runAction.call(bare));
show("no prototype readSecret", () => s.readSecret.call(bare));
show("no prototype storeCount", () => s.storeCount.call(bare));
show("no prototype bump", () => s.bump.call(bare));
show("no prototype storeLabel", () => s.storeLabel.call(bare));
show("no prototype callsOther", () => s.callsOther.call(bare));
show("no prototype kind", () => s.kind.call(bare));
show("inherits readCount", () => s.readCount.call(inherits));
show("inherits countPlusOne", () => s.countPlusOne.call(inherits));
show("inherits readLabel", () => s.readLabel.call(inherits));
show("inherits labelLength", () => s.labelLength.call(inherits));
show("inherits ownerName", () => s.ownerName.call(inherits));
show("inherits runAction", () => s.runAction.call(inherits));
show("inherits readSecret", () => s.readSecret.call(inherits));
show("inherits storeCount", () => s.storeCount.call(inherits));
show("inherits bump", () => s.bump.call(inherits));
show("inherits storeLabel", () => s.storeLabel.call(inherits));
show("inherits callsOther", () => s.callsOther.call(inherits));
show("inherits kind", () => s.kind.call(inherits));
show("log", () => log.join(" "));
show("keys of the array", () => Object.keys(list).join());
show("keys of the function", () => Object.keys(plain).join());
show("keys of the one without a prototype", () => Object.keys(bare).join());
show("keys of the one that inherits", () => Object.keys(inherits).join());
show("afterwards: count", () => s.count);
show("afterwards: label", () => s.label);
show("afterwards: keys", () => Object.keys(s).join());
show("on the object: readCount", () => s.readCount());
show("on the object: readSecret", () => s.readSecret());
show("on the object: callsOther", () => s.callsOther());
