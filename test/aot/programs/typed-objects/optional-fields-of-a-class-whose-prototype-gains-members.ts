function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}

function chunk(x: number): number {
  return x + 1;
}
const seen: string[] = [];
function look(at: object): number {
  seen.push(Object.keys(at).join());
  return seen.length;
}

interface Core {
  view?: boolean;
  refresh?: () => number;
}
class Core {
  key = "k";
  count = 0;
  origin!: string;
  rewrite?: { from: string };
  decoder?: (text: string) => string;
  update = (rewrite: { from: string } | undefined, origin: string) => {
    this.rewrite = rewrite;
    this.origin = origin;
  };
  arrow = (x: number) => x + this.count;
  loadChunk = chunk;
  later = (x: number) => x - this.count;
  ssr?: { m: number };
  serverSsr?: { m: number };
  looked = look(this);
  lifecycle?: { m: number };
  last?: string;
  constructor(rewrite: { from: string } | undefined) {
    this.update(rewrite, "o");
  }
  setSsr(value: { m: number } | undefined) {
    this.ssr = value;
  }
  setLast(value: string | undefined) {
    this.last = value;
  }
  setView(value: boolean | undefined) {
    this.view = value;
  }
}
Core.prototype.refresh = function () {
  return 7;
};
class Router extends Core {
  own = 1;
  more?: { m: number };
  constructor(rewrite: { from: string } | undefined) {
    super(rewrite);
  }
  setMore(value: { m: number } | undefined) {
    this.more = value;
  }
}

function show(core: Core) {
  return [Object.keys(core).join(), core.rewrite, core.ssr, core.serverSsr, core.lifecycle, core.last, core.view, core.origin];
}

say("born with nothing", () => show(new Core(undefined)));
say("born with a value", () => show(new Core({ from: "f" })));
say("an heir", () => show(new Router(undefined)));
say("an heir born with a value", () => show(new Router({ from: "g" })));
say("what an initializer saw", () => seen);
say("undefined, then a value, then undefined", () => {
  const core = new Core(undefined);
  const steps: unknown[] = [];
  core.setSsr(undefined);
  steps.push(show(core), "ssr" in core, Object.getOwnPropertyDescriptor(core, "ssr"));
  core.setSsr({ m: 1 });
  steps.push(show(core));
  core.setSsr(undefined);
  steps.push(show(core), core.hasOwnProperty("ssr"));
  return steps;
});
say("a text, and the field of the interface", () => {
  const core = new Router(undefined);
  core.setLast("l");
  core.setView(undefined);
  const first = show(core);
  core.setView(true);
  core.setMore(undefined);
  core.setMore({ m: 2 });
  return [first, show(core), core.more, core.refresh!()];
});
say("many", () => {
  let total = 0;
  for (let i = 0; i < 3000; i++) {
    const core = i & 1 ? new Core(i & 2 ? { from: "x" } : undefined) : new Router(i & 4 ? { from: "yy" } : undefined);
    core.setSsr(i % 3 ? undefined : { m: i });
    core.setLast(i % 5 ? undefined : "t");
    total += Object.keys(core).length + (core.ssr?.m ?? 0) + (core.rewrite?.from.length ?? 0) + (core.last?.length ?? 0);
  }
  return total;
});
say("deleted, then stored", () => {
  const core = new Core(undefined);
  delete core.ssr;
  const without = Object.keys(core).join();
  core.setSsr(undefined);
  const again = [Object.keys(core).join(), "ssr" in core];
  delete core.last;
  core.setLast("z");
  return [without, again, Object.keys(core).join(), core.last];
});
say("frozen", () => {
  const core = new Core(undefined);
  Object.freeze(core);
  const results: unknown[] = [];
  for (const store of [() => core.setSsr(undefined), () => core.setSsr({ m: 1 }), () => core.setLast("x")]) {
    try {
      store();
      results.push("stored");
    } catch (error) {
      results.push((error as Error).constructor.name);
    }
  }
  return [results, show(core)];
});
say("sealed, and not extensible", () => {
  const sealed = new Core(undefined);
  Object.seal(sealed);
  sealed.setSsr({ m: 3 });
  sealed.setLast(undefined);
  const closed = new Router(undefined);
  Object.preventExtensions(closed);
  closed.setSsr({ m: 4 });
  let refused = "no";
  try {
    closed.setView(true);
  } catch (error) {
    refused = (error as Error).constructor.name;
  }
  return [show(sealed), show(closed), refused];
});
say("a setter that comes onto the prototype later", () => {
  const log: string[] = [];
  const before = new Core(undefined);
  Object.defineProperty(Core.prototype, "ssr", {
    set(value) {
      log.push("set " + JSON.stringify(value));
    },
    get() {
      return undefined;
    },
    configurable: true,
  });
  before.setSsr({ m: 1 });
  before.setSsr(undefined);
  const after = new Core(undefined);
  after.setSsr({ m: 2 });
  const deleted = new Router(undefined);
  delete deleted.ssr;
  deleted.setSsr({ m: 3 });
  deleted.setSsr(undefined);
  const result = [log, show(before), show(after), show(deleted), "ssr" in deleted, deleted.hasOwnProperty("ssr")];
  delete (Core.prototype as any).ssr;
  deleted.setSsr({ m: 4 });
  return [result, show(deleted)];
});
