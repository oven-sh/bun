function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}

class Tree {
  depth: number;
  constructor(depth: number) {
    this.depth = depth;
  }
}
class TallTree extends Tree {
  height = 100;
}
type Caches = { byId: Record<string, number>; byPath: Record<string, number>; tree: Tree; paths: Map<string, string> };

class Router {
  key: string | undefined = "k";
  count = 0;
  options!: { a: number };
  origin!: string;
  byId!: Record<string, number>;
  byPath!: Record<string, number>;
  tree!: Tree;
  paths!: Map<string, string>;
  light!: WeakMap<object, number>;
  rewrite?: { from: string };
  list?: string[];
  run?: () => number;
  constructor(options: { a: number }) {
    this.options = options;
    this.origin = "x";
  }
  setRoutes(caches: Caches) {
    Object.assign(this, caches);
  }
  take(given: Partial<Router>) {
    Object.assign(this, given);
  }
  takeAny(given: any) {
    Object.assign(this, given);
  }
  takeTwo(first: Partial<Router>, second: Partial<Router>) {
    return Object.assign(this, first, second) === this;
  }
}

function show(router: Router) {
  return [Object.keys(router).join(), router.byId, router.byPath, router.tree, router.paths instanceof Map ? [...router.paths] : router.paths, router.origin, router.count];
}

const caches: Caches = { byId: { a: 1 }, byPath: { b: 2 }, tree: new Tree(3), paths: new Map([["p", "q"]]) };

say("a record of objects", () => {
  const router = new Router({ a: 1 });
  router.setRoutes(caches);
  return [show(router), router.tree === caches.tree, router.paths === caches.paths, router.byId === caches.byId];
});
say("many times, with trees of two classes", () => {
  let total = 0;
  const tall: Caches = { byId: { a: 2 }, byPath: {}, tree: new TallTree(5), paths: new Map() };
  for (let i = 0; i < 2000; i++) {
    const router = new Router({ a: i });
    router.setRoutes(i % 3 ? caches : tall);
    total += router.tree.depth + router.byId.a + (router.tree instanceof TallTree ? router.tree.height : 0);
  }
  return total;
});
say("over values that are there", () => {
  const router = new Router({ a: 1 });
  router.setRoutes(caches);
  router.setRoutes({ byId: { z: 26 }, byPath: { y: 25 }, tree: new TallTree(9), paths: new Map() });
  return show(router);
});
say("data from outside", () => {
  const router = new Router({ a: 1 });
  router.takeAny(JSON.parse('{"byId":{"a":1},"byPath":{"b":2},"origin":"o","count":7}'));
  return show(router);
});
say("optional fields come to be in the order of the source", () => {
  const router = new Router({ a: 1 });
  router.take({ run: () => 4, list: ["l"], rewrite: { from: "f" } });
  return [Object.keys(router).join(), router.run!(), router.list, router.rewrite];
});
say("two sources", () => {
  const router = new Router({ a: 1 });
  return [router.takeTwo({ origin: "first", list: ["a"] }, { origin: "second", tree: new Tree(1) }), show(router), router.list];
});
say("undefined and null for objects", () => {
  const router = new Router({ a: 1 });
  router.setRoutes(caches);
  router.takeAny({ tree: undefined, paths: null, rewrite: undefined });
  return [Object.keys(router).join(), router.tree === undefined, router.paths === null, "rewrite" in router];
});
say("names that are not declared", () => {
  const router = new Router({ a: 1 });
  router.takeAny({ extra: { e: 1 }, tree: new Tree(2), another: [1, 2] });
  return [Object.keys(router).join(), (router as any).extra, (router as any).another, router.tree];
});
say("a getter of the source runs once, in its turn, and may change the target", () => {
  const router = new Router({ a: 1 });
  const seen: string[] = [];
  const source = {
    get byId() {
      seen.push("byId:" + router.origin);
      router.origin = "changed";
      return { g: 1 };
    },
    origin: "from the source",
    get tree() {
      seen.push("tree:" + router.origin);
      return new Tree(8);
    },
  };
  router.takeAny(source);
  return [seen, router.byId, router.origin, router.tree];
});
say("what is not enumerable, inherited, or keyed by a symbol", () => {
  const router = new Router({ a: 1 });
  const mark = Symbol("mark");
  const source = Object.create({ origin: "inherited" });
  Object.defineProperty(source, "tree", { value: new Tree(1), enumerable: false });
  source.byId = { own: 1 };
  source[mark] = { s: 1 };
  router.takeAny(source);
  return [router.origin, router.tree === undefined, router.byId, (router as any)[mark], Object.getOwnPropertySymbols(router).length];
});
say("a Proxy as the source", () => {
  const router = new Router({ a: 1 });
  const seen: string[] = [];
  router.takeAny(
    new Proxy(
      { tree: new Tree(6), origin: "p" },
      {
        ownKeys(target) {
          seen.push("ownKeys");
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          seen.push("describe " + String(key));
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        get(target, key, receiver) {
          seen.push("get " + String(key));
          return Reflect.get(target, key, receiver);
        },
      },
    ),
  );
  return [seen, router.tree, router.origin];
});
say("a frozen target", () => {
  const router = new Router({ a: 1 });
  router.setRoutes(caches);
  Object.freeze(router);
  try {
    router.setRoutes({ byId: {}, byPath: {}, tree: new Tree(0), paths: new Map() });
  } catch (error) {
    return [(error as Error).constructor.name, show(router)];
  }
  return "no error";
});
say("a sealed target takes what it has and refuses what it lacks", () => {
  const router = new Router({ a: 1 });
  Object.seal(router);
  router.setRoutes(caches);
  try {
    router.take({ tree: new Tree(7), rewrite: { from: "r" } });
  } catch (error) {
    return [(error as Error).constructor.name, show(router)];
  }
  return ["no error", show(router)];
});
say("the target itself, nothing, and primitives", () => {
  const router = new Router({ a: 1 });
  router.setRoutes(caches);
  router.takeAny(router);
  router.takeAny(undefined);
  router.takeAny(null);
  router.takeAny(5);
  router.takeAny("ab");
  return [Object.keys(router).join(), (router as any)[0], (router as any)[1], router.tree];
});

class WithSetter {
  seen: string[] = [];
  plain!: Tree;
  set tree(value: Tree) {
    this.seen.push("set " + value.depth);
  }
  get tree(): Tree {
    return new Tree(-1);
  }
  take(given: { tree: Tree; plain: Tree }) {
    Object.assign(this, given);
  }
}
say("a setter of the class is called", () => {
  const target = new WithSetter();
  target.take({ tree: new Tree(4), plain: new Tree(5) });
  return [target.seen, target.plain, Object.keys(target).join(), target.tree];
});

class Holder {
  held!: Tree;
  name!: string;
  takeAny(given: any) {
    Object.assign(this, given);
  }
}
say("after many that fit, some that are of another kind", () => {
  const holder = new Holder();
  const results: unknown[] = [];
  for (let i = 0; i < 50; i++) holder.takeAny({ held: new Tree(i), name: "n" + i });
  results.push(holder.held.depth, holder.name);
  for (const other of [{ held: new TallTree(1), name: "tall" }, { held: new Tree(2), name: "again" }]) {
    holder.takeAny(other);
    results.push(holder.held.depth, holder.held instanceof TallTree, holder.name);
  }
  return results;
});
say("kept over collections", () => {
  const kept: Router[] = [];
  for (let i = 0; i < 30000; i++) {
    const router = new Router({ a: i });
    router.setRoutes({ byId: { i }, byPath: { i }, tree: i & 1 ? new Tree(i) : new TallTree(i), paths: new Map([["i", String(i)]]) });
    if (i % 5000 === 0) kept.push(router);
  }
  return kept.map((router) => [router.byId.i, router.tree.depth, router.paths.get("i"), router.options.a]);
});
