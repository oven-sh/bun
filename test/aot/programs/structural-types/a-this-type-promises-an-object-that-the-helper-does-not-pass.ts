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

interface Description<D, M> {
  data: D;
  methods: M & ThisType<D & M>;
}

function joined<D extends object, M extends object>(description: Description<D, M>): D & M {
  return Object.assign({}, description.data, description.methods);
}
function onlyMethods<D extends object, M extends object>(description: Description<D, M>): M {
  return description.methods;
}
function dataBelow<D extends object, M extends object>(description: Description<D, M>): M {
  return Object.assign(Object.create(description.data), description.methods);
}

const honest = joined({
  data: { count: 1, label: "component" },
  methods: {
    read(): number {
      return this.count;
    },
    bump(): number {
      return ++this.count;
    },
    title(): string {
      return this.label.toUpperCase();
    },
    twice(): number {
      return this.read() * 2;
    },
  },
});
show("joined: read", () => honest.read());
show("joined: bump", () => honest.bump());
show("joined: title", () => honest.title());
show("joined: twice", () => honest.twice());
show("joined: keys", () => Object.keys(honest).join());

const bare = onlyMethods({
  data: { count: 1, label: "component" },
  methods: {
    read(): number {
      return this.count;
    },
    bump(): number {
      return ++this.count;
    },
    title(): string {
      return this.label.toUpperCase();
    },
    twice(): number {
      return this.read() * 2;
    },
  },
});
show("only the methods: read", () => bare.read());
show("only the methods: bump", () => bare.bump());
show("only the methods: title", () => bare.title());
show("only the methods: twice", () => bare.twice());
show("only the methods: keys", () => Object.keys(bare).join());

const source = { count: 1, label: "below" };
const below = dataBelow({
  data: source,
  methods: {
    read(): number {
      return this.count;
    },
    bump(): number {
      return ++this.count;
    },
    title(): string {
      return this.label.toUpperCase();
    },
  },
});
show("data on the prototype: read", () => below.read());
show("data on the prototype: bump", () => below.bump());
show("data on the prototype: title", () => below.title());
show("data on the prototype: keys", () => Object.keys(below).join());
show("data on the prototype: the source", () => source.count);
