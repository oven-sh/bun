// Stores of `undefined` or `null` into a property whose declared type excludes both, made through a wider type of the same object.
// Everything here type-checks, and each store must behave as it does in plain JavaScript.
// Each case declares its own types, told apart by a marker property, so that one case cannot change how another's objects are stored.
function report(label: string, run: () => string): void {
  try {
    console.log(label + ":", run());
  } catch (e) {
    console.log(label + ":", "throws", (e as Error).name);
  }
}

report("index signature, computed key", () => {
  type Leaf = { n: number; case1: true };
  type Holder = { leaf: Leaf; name: string; case1: true };
  const h: Holder = { leaf: { n: 1, case1: true }, name: "holder", case1: true };
  const dictionary: { [key: string]: unknown } = h;
  for (const key of Object.keys(dictionary)) if (key === "leaf") dictionary[key] = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("generic key of the type", () => {
  type Leaf = { n: number; case2: true };
  type Holder = { leaf: Leaf; name: string; case2: true };
  function setByKey<K extends keyof Holder>(target: Holder, key: K, value: Holder[K]): void {
    target[key] = value;
  }
  const noLeaves: Leaf[] = [];
  const h: Holder = { leaf: { n: 2, case2: true }, name: "holder", case2: true };
  setByKey(h, "leaf", noLeaves[3]);
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("nested object through a wider outer type", () => {
  type Leaf = { n: number; case3: true };
  type Holder = { leaf: Leaf; name: string; case3: true };
  type Outer = { inner: Holder };
  type WideOuter = { inner: { leaf?: Leaf } };
  const h: Holder = { leaf: { n: 3, case3: true }, name: "holder", case3: true };
  const outer: Outer = { inner: h };
  const wide: WideOuter = outer;
  wide.inner.leaf = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("callback whose parameter is any", () => {
  type Leaf = { n: number; case4: true };
  type Holder = { leaf: Leaf; name: string; case4: true };
  const clear: (target: Holder) => void = (target: any) => {
    target.leaf = undefined;
  };
  const h: Holder = { leaf: { n: 4, case4: true }, name: "holder", case4: true };
  clear(h);
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("callback whose parameter is any, computed key", () => {
  type Leaf = { n: number; case5: true };
  type Holder = { leaf: Leaf; name: string; case5: true };
  const clear: (target: Holder, key: string) => void = (target: any, key: string) => {
    target[key] = null;
  };
  const h: Holder = { leaf: { n: 5, case5: true }, name: "holder", case5: true };
  clear(h, "leaf");
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("Reflect.set through object", () => {
  type Leaf = { n: number; case6: true };
  type Holder = { leaf: Leaf; name: string; case6: true };
  function clearLeaf(target: object): void {
    for (const key of Object.keys(target)) if (key === "leaf") Reflect.set(target, key, undefined);
  }
  const h: Holder = { leaf: { n: 6, case6: true }, name: "holder", case6: true };
  clearLeaf(h);
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("Object.assign from a partial", () => {
  type Leaf = { n: number; case7: true };
  type Holder = { leaf: Leaf; name: string; case7: true };
  const h: Holder = { leaf: { n: 7, case7: true }, name: "holder", case7: true };
  const patch: Partial<Holder> = { leaf: undefined };
  Object.assign(h, patch);
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("element of a wider array", () => {
  type Leaf = { n: number; case8: true };
  type Holder = { leaf: Leaf; name: string; case8: true };
  const h: Holder = { leaf: { n: 8, case8: true }, name: "holder", case8: true };
  const holders: Holder[] = [h];
  const wide: { leaf?: Leaf }[] = holders;
  wide[0].leaf = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("value of a wider map", () => {
  type Leaf = { n: number; case9: true };
  type Holder = { leaf: Leaf; name: string; case9: true };
  const h: Holder = { leaf: { n: 9, case9: true }, name: "holder", case9: true };
  const holders = new Map<string, Holder>([["a", h]]);
  const wide: Map<string, { leaf?: Leaf }> = holders;
  wide.get("a")!.leaf = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("result of a function seen through a wider type", () => {
  type Leaf = { n: number; case10: true };
  type Holder = { leaf: Leaf; name: string; case10: true };
  const h: Holder = { leaf: { n: 10, case10: true }, name: "holder", case10: true };
  const get: () => Holder = () => h;
  const wideGet: () => { leaf?: Leaf } = get;
  wideGet().leaf = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("property of a class instance through a wider interface", () => {
  type Leaf = { n: number; case11: true };
  type Holder = { leaf: Leaf; name: string; case11: true };
  class Box {
    constructor(public held: Holder) {}
  }
  interface WideBox {
    held: { leaf?: Leaf };
  }
  const h: Holder = { leaf: { n: 11, case11: true }, name: "holder", case11: true };
  const wide: WideBox = new Box(h);
  wide.held.leaf = undefined;
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});

report("promise of a wider type", () => {
  type Leaf = { n: number; case12: true };
  type Holder = { leaf: Leaf; name: string; case12: true };
  const h: Holder = { leaf: { n: 12, case12: true }, name: "holder", case12: true };
  const wide: Promise<{ leaf?: Leaf }> = Promise.resolve(h);
  wide.then(value => {
    value.leaf = undefined;
    console.log("promise of a wider type, later:", h.leaf === undefined ? "undefined" : "kept");
  });
  return h.leaf === undefined ? "undefined" : h.leaf === null ? "null" : String(h.leaf.n);
});
