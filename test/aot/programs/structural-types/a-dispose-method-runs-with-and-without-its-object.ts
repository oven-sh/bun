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

const log: string[] = [];

class Handle {
  name: string;
  open: boolean = true;
  constructor(name: string) {
    this.name = name;
  }
  [Symbol.dispose](): void {
    this.open = false;
    log.push("closed " + this.name);
  }
  close(): void {
    this[Symbol.dispose]();
  }
}

show("using", () => {
  using handle = new Handle("first");
  log.push("in use " + handle.name);
  return handle.open;
});
show("log", () => log.splice(0).join(", "));
show("two of them close in reverse order", () => {
  using a = new Handle("a");
  using b = new Handle("b");
  return a.open && b.open;
});
show("log", () => log.splice(0).join(", "));
show("the dispose method, taken off", () => {
  const handle = new Handle("bare");
  const dispose = handle[Symbol.dispose];
  dispose();
  return handle.open;
});
show("close, taken off", () => {
  const { close } = new Handle("bare close");
  close();
});
show("dispose on a look-alike", () => {
  const like = { name: "like", open: true };
  new Handle("source")[Symbol.dispose].call(like);
  return like.open;
});
show("log", () => log.splice(0).join(", "));
show("a literal that borrows the method", () => {
  const source = new Handle("source");
  {
    using borrowed = { name: "borrowed", open: true, [Symbol.dispose]: source[Symbol.dispose] };
    log.push("in use " + borrowed.name);
  }
  return source.open;
});
show("log", () => log.splice(0).join(", "));
show("a literal whose dispose lost its object", () => {
  const source = new Handle("source");
  const dispose = source[Symbol.dispose];
  using broken = { [Symbol.dispose]: () => dispose() };
  return typeof broken;
});
show("log", () => log.splice(0).join(", "));
show("a stack that is handed the bare method", () => {
  const source = new Handle("stacked");
  const stack = new DisposableStack();
  stack.defer(source[Symbol.dispose].bind(source));
  stack.dispose();
  return source.open;
});
show("log", () => log.splice(0).join(", "));
