const log: string[] = [];

class Resource {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  [Symbol.dispose](): void {
    log.push("class dispose " + this.name);
  }
}

class AsyncResource {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  async [Symbol.asyncDispose](): Promise<void> {
    log.push("class async dispose " + this.name);
  }
}

function line(label: string): void {
  console.log(label + ": " + log.join(", "));
  log.length = 0;
}

function plain(): void {
  using r = new Resource("a");
  log.push("body " + r.name);
}

function replacedInTheBody(): void {
  using r = new Resource("b");
  r[Symbol.dispose] = () => {
    log.push("own dispose");
  };
  log.push("body " + r.name);
}

function replacedBefore(): void {
  const made = new Resource("c");
  made[Symbol.dispose] = () => {
    log.push("own dispose, set before");
  };
  using r = made;
  log.push("body " + r.name);
}

function prototypeReplacedInTheBody(): void {
  using r = new Resource("d");
  Resource.prototype[Symbol.dispose] = function () {
    log.push("patched dispose " + this.name);
  };
  log.push("body " + r.name);
}

function two(): void {
  using first = new Resource("first");
  using second = new Resource("second");
  log.push("body " + first.name + " " + second.name);
}

async function asynchronous(): Promise<void> {
  await using r = new AsyncResource("e");
  r[Symbol.asyncDispose] = async () => {
    log.push("own async dispose");
  };
  log.push("body " + r.name);
}

const original = Resource.prototype[Symbol.dispose];

for (let i = 0; i < 2000; i++) plain();
console.log("2000 honest: " + log.length);
log.length = 0;

plain();
line("nothing replaced");
replacedInTheBody();
line("an own member appears in the body");
replacedBefore();
line("an own member from before the declaration");
prototypeReplacedInTheBody();
line("the prototype's is replaced in the body");
plain();
line("the next resource");
two();
line("two resources");
Resource.prototype[Symbol.dispose] = original;
two();
line("put back");
await asynchronous();
line("an asynchronous one");

export {};
