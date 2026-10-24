// Objects of declared types get properties beyond their types under computed keys, by definition, by name, in turns: each road sees what the others did, also at sites that have served other objects before.
const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));

class Request {
  url: unknown = "/";
  next: Request | null = null;
}
class Full {
  first: unknown = 1;
  second: unknown = 2;
}
interface Point {
  x: number;
  y: number;
}
const makers: [string, (key: string, v: number) => any][] = [
  ["Request", (key, v) => { const o: any = new Request(); o[key] = v; return o; }],
  ["Full", (key, v) => { const o: any = new Full(); o[key] = v; return o; }],
  ["Point", (key, v): Point => ({ x: 1, y: 2, [key]: v })],
  ["plain", (key, v) => ({ plain: true, [key]: v })],
];
const readNamed = (o: any) => o.named;
const readFirstKey = (o: any) => o.k0;
const readMissing = (o: any) => o.missing;
const storeNamed = (o: any, v: unknown) => { o.named = v; };
const storeFirstKey = (o: any, v: unknown) => { o.k0 = v; };
const storeOther = (o: any, v: unknown) => { o.other = v; };
const storeByKey = (o: any, key: string, v: unknown) => { o[key] = v; };
const attempt = (store: () => void) => {
  try {
    store();
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
const describe = (o: any) => [Object.keys(o).join(), JSON.stringify(o), readNamed(o), readFirstKey(o), readMissing(o)];

for (const [label, make] of makers) {
  for (let round = 0; round < 6; round++) {
    const key = "k" + (round % 3);
    const o = make(key, round);
    show(label + " born " + round, describe(o));
    storeNamed(o, round + 10);
    show(label + " named " + round, describe(o));
    storeByKey(o, "late" + (round % 2), round + 20);
    show(label + " by key " + round, describe(o));
    storeOther(o, round + 30);
    storeFirstKey(o, round + 40);
    show(label + " both " + round, describe(o));
    storeNamed(o, "again");
    storeByKey(o, "named", "by key");
    show(label + " replaced " + round, describe(o));
  }
}

for (const [label, make] of makers) {
  for (let round = 0; round < 4; round++) {
    const o = make("k0", round);
    storeNamed(o, 1);
    delete o.k0;
    show(label + " deleted " + round, describe(o));
    storeFirstKey(o, 2);
    show(label + " given again " + round, describe(o));
    Object.defineProperty(o, "named", { value: 3, writable: false, enumerable: true, configurable: true });
    show(label + " read only " + round, [attempt(() => storeNamed(o, 4)), describe(o)]);
    Object.defineProperty(o, "named", { get() { return "got " + this.k0; }, set(v) { this.k0 = "set " + v; }, enumerable: false, configurable: true });
    storeNamed(o, 5);
    show(label + " accessor " + round, describe(o));
    delete o.named;
    storeNamed(o, 6);
    show(label + " data again " + round, describe(o));
  }
}

for (const [label, make] of makers) {
  for (let round = 0; round < 4; round++) {
    const sealed = make("k0", round);
    storeNamed(sealed, 1);
    Object.seal(sealed);
    const onSealed = [attempt(() => storeNamed(sealed, 2)), attempt(() => storeOther(sealed, 3)), attempt(() => storeByKey(sealed, "late0", 4))];
    show(label + " sealed " + round, [onSealed, describe(sealed), Object.isSealed(sealed), Object.isFrozen(sealed)]);
    const frozen = make("k0", round);
    storeNamed(frozen, 1);
    Object.freeze(frozen);
    const onFrozen = [attempt(() => storeNamed(frozen, 2)), attempt(() => storeFirstKey(frozen, 3)), attempt(() => storeByKey(frozen, "k0", 4))];
    show(label + " frozen " + round, [onFrozen, describe(frozen), Object.isSealed(frozen), Object.isFrozen(frozen)]);
    const closed = make("k0", round);
    Object.preventExtensions(closed);
    const onClosed = [attempt(() => storeNamed(closed, 1)), attempt(() => storeFirstKey(closed, 2))];
    show(label + " closed " + round, [onClosed, describe(closed), Object.isExtensible(closed)]);
  }
}

for (const [label, make] of makers) {
  const kept: any[] = [];
  for (let i = 0; i < 300; i++) {
    const o = make("k" + (i % 40), i);
    if (i % 3 === 0) storeNamed(o, i);
    if (i % 5 === 0) storeByKey(o, "w" + i, i);
    if (i % 7 === 0) storeOther(o, i);
    kept.push(o);
  }
  let sum = 0, keys = 0;
  for (const o of kept) {
    sum += (readNamed(o) ?? 0) + (readFirstKey(o) ?? 0) + (o.other ?? 0);
    keys += Object.keys(o).length;
  }
  show(label + " many", [sum, keys, Object.keys(kept[105]).join(), { ...kept[210] }, structuredClone(kept[0])]);
}
