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

class Registry {
  static count: number = 3;
  static label: string = "registry";
  static #made: number = 0;
  static read(): number {
    return this.count;
  }
  static title(): string {
    return this.label.toUpperCase();
  }
  static bump(): number {
    return ++this.count;
  }
  static make(): Registry {
    return new this();
  }
  static made(): number {
    return ++this.#made;
  }
  static viaName(): number {
    return Registry.count;
  }
  static kind(): string {
    return typeof this;
  }
  static twice(): number {
    return this.read() * 2;
  }
  id: number = 1;
}

class Child extends Registry {
  static count: number = 30;
  extra: number = 2;
}

const { read, title, bump, make, made, viaName, kind, twice } = Registry;

show("read", () => read());
show("title", () => title());
show("bump", () => bump());
show("make", () => make());
show("made", () => made());
show("viaName", () => viaName());
show("kind", () => kind());
show("twice", () => twice());
show("map read", () => [0].map(Registry.read)[0]);
show("map read with the class as this", () => [0].map(Registry.read, Registry)[0]);
show("map read with the child as this", () => [0].map(Registry.read, Child)[0]);
show("map read with an instance as this", () => [0].map(Registry.read, new Registry())[0]);

show("on the child: read", () => Child.read());
show("on the child: bump", () => Child.bump());
show("on the child: make", () => Object.keys(Child.make()).join());
show("on the child: made", () => Child.made());
show("on the child: twice", () => Child.twice());
show("call with the child: read", () => Registry.read.call(Child));
show("call with a look-alike: read", () => Registry.read.call({ count: 300 }));
show("call with a look-alike: title", () => Registry.title.call({ label: "small" }));
show("call with a wrong look-alike: title", () => Registry.title.call({ label: 5 }));
show("call with a look-alike: twice", () => Registry.twice.call({ count: 1, read: () => 21 }));
show("call with another class: make", () => Object.keys(Registry.make.call(Child)).join());
show("call with Map: make", () => String(Registry.make.call(Map)));
show("call with a function: make", () => typeof Registry.make.call(function Plain() {}));
show("call with an arrow: make", () => Registry.make.call(() => {}));
show("call with a look-alike: made", () => Registry.made.call({}));

const holder = { count: 7, read: Registry.read, bump: Registry.bump };
show("as a member of an object: read", () => holder.read());
show("as a member of an object: bump", () => holder.bump());
show("the class afterwards", () => Registry.count + " " + Child.count);
