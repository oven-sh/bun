import type { Imported } from "./imported";
interface BaseZ {
  zBase: number;
  aBase: string;
}
interface BaseA {
  anotherBase: boolean;
  zBase: number;
}
interface Child extends BaseZ, BaseA {
  childZ: number;
  childA: string;
}
interface Merged {
  firstZ: number;
  firstA: string;
}
interface Merged {
  laterZ: boolean;
  laterA: number;
}
interface Generic<T> extends BaseZ {
  own: T;
  next: T[];
}
const base = { left: { used: 1, missing: 2 }, duplicate: 1 };
const spread = { before: 0, ...base, right: { used: 3, missing: 4 }, duplicate: "later" };
declare let literal: { z: number; a: string; 9: boolean; 2: number };
declare let child: Child;
interface HeritageReverse extends BaseA, BaseZ {
  own: boolean;
}
declare let heritageReverse: HeritageReverse;
declare let intersectionReverse: BaseA & BaseZ;
declare let merge: Merged;
declare let intersect: { z1: number; a1: string } & { z2: boolean; a2: string };
declare let union: { z1: number; commonZ: string; commonA: number } | { commonA: number; commonZ: string; a2: boolean };
declare let copied: typeof spread;
declare let mapped: { [K in "z" | "a" | "m"]: number };
declare let picked: Pick<{ z: number; a: string; m: boolean }, "m" | "z">;
declare let omitted: Omit<{ z: number; a: string; m: boolean }, "a">;
declare let partial: Partial<{ z: number; a: string; m: boolean }>;
declare let remapped: { [K in "z" | "a" as Uppercase<K>]: number };
declare let generic: Generic<{ z: number; a: string }>;
declare let imported: Imported;
declare let stringUnion: "z" | "a";
declare let optional: { z?: "z" | "a"; callback: (value: string) => void; tuple: [string, number] };

// Heritage over several levels, an override, and a class.
interface Grand {
  zGrand: number;
  aGrand: string;
}
interface Parent extends Grand {
  zParent: number;
  aParent: string;
}
interface Deep extends Parent, BaseA {
  own: number;
  zGrand: number;
}
declare let deep: Deep;
class Animal {
  zAnimal = 1;
  aAnimal = "";
  move() {}
}
class Dog extends Animal {
  bark() {}
  zDog = 2;
  [Symbol.iterator]() {
    return [][Symbol.iterator]();
  }
}
declare let dog: Dog;
declare let iterable: { zOwn: number; [Symbol.iterator](): Iterator<number>; aOwn: string };

// Declarations merged across files, in the order of the program, then `declare global`.
declare let globalMerged: GlobalMerged;

// Generic instantiations.
interface Boxed<T> extends HeritageReverse {
  value: T;
  zBoxed: T;
}
declare let boxed: Boxed<string>;
type Pair<T> = { zFirst: T; aSecond: T };
declare let pair: Pair<number>;
type WithBases<T> = T & BaseA & BaseZ;
declare let withBases: WithBases<{ zOwn: 1; aOwn: 2 }>;

// Intersections: the first occurrence of a name counts.
declare let overlap: { z: number; shared: string } & { a: number; shared: string };
declare let intersectHeritage: { first: 1 } & HeritageReverse & { last: 1 };

// Spreads: the right operand first, then what the left adds.
const left = { zLeft: 1, aLeft: 2, shared: 1 };
const right = { aRight: 1, shared: "", zRight: 2 };
const twoSpreads = { ...left, middle: 1, ...right, end: true };
declare let twoSpreadsType: typeof twoSpreads;
declare const heritageValue: HeritageReverse;
const ofInterface = { first: 0, ...heritageValue, extra: 1 };
declare let ofInterfaceType: typeof ofInterface;
const nestedSpread = { outer: 1, ...{ inner: 2, ...left } };
declare let nestedSpreadType: typeof nestedSpread;
const overridden = { shared: 0, zBefore: 1, ...left };
declare let overriddenType: typeof overridden;
declare const restSource: { zRest: 1; drop: 2; aRest: 3 };
const { drop, ...rest } = restSource;
declare let restType: typeof rest;

// Mapped types over `keyof T` follow the properties of `T`.
declare let partialHeritage: Partial<HeritageReverse>;
declare let readonlyChild: Readonly<Child>;
declare let renamed: { [K in keyof HeritageReverse as `get${Capitalize<K & string>}`]: () => HeritageReverse[K] };

// Nested types and what is printed.
declare let nested: { outer: { zInner: number; aInner: { deep: HeritageReverse } }; spreadInside: typeof twoSpreads };
type Aliased = { zAlias: 1; aAlias: 2 };
declare let aliased: Aliased;
declare let printed: {
  fn: (a: string) => void;
  method(b: number): string;
  opt?: number;
  tuple: [string, number?];
  list: HeritageReverse[];
  index: { [key: string]: number; zKnown: number };
  promise: Promise<{ z: 1; a: 2 }>;
  generic: Generic<Pair<string>>;
  both: Aliased & { extra: true };
};

// What a reverse mapped type infers has the order of its source.
declare function unwrap<T>(input: { [K in keyof T]: { value: T[K] } }): T;
const unwrapped = unwrap({ ...{ zLeft: { value: 1 } }, aRight: { value: 2 } });
declare let reverseMapped: typeof unwrapped;

// Spreads of spreads, deeper than any limit on how deep they are followed.
const spread0 = { zFirst: 1 };
const spread1 = { ...spread0, p1: 1 };
const spread2 = { ...spread1, p2: 1 };
const spread3 = { ...spread2, p3: 1 };
const spread4 = { ...spread3, p4: 1 };
const spread5 = { ...spread4, p5: 1 };
const spread6 = { ...spread5, p6: 1 };
const spread7 = { ...spread6, p7: 1 };
const spread8 = { ...spread7, p8: 1 };
const spread9 = { ...spread8, p9: 1 };
const spread10 = { ...spread9, p10: 1 };
const spread11 = { ...spread10, p11: 1 };
const spread12 = { ...spread11, p12: 1 };
const spread13 = { ...spread12, p13: 1 };
const spread14 = { ...spread13, p14: 1 };
const spread15 = { ...spread14, p15: 1 };
const spread16 = { ...spread15, p16: 1 };
const spread17 = { ...spread16, p17: 1 };
const spread18 = { ...spread17, p18: 1 };
const spread19 = { ...spread18, p19: 1 };
const spread20 = { ...spread19, p20: 1 };
declare let deepSpread: typeof spread20;

// The statics of a class after its `prototype`, the functions of a namespace before its other exports.
class Statics {
  static zStatic = 1;
  static aStatic = 2;
}
declare let statics: typeof Statics;
namespace Exports {
  export const zConst = 1;
  export function middle() {}
  export const aConst = 2;
}
declare let exportsOfNamespace: typeof Exports;

// The variables above, as the props of main.svelte.
export interface Cases {
  literal: typeof literal;
  child: typeof child;
  heritageReverse: typeof heritageReverse;
  intersectionReverse: typeof intersectionReverse;
  merge: typeof merge;
  intersect: typeof intersect;
  union: typeof union;
  copied: typeof copied;
  mapped: typeof mapped;
  picked: typeof picked;
  omitted: typeof omitted;
  partial: typeof partial;
  remapped: typeof remapped;
  generic: typeof generic;
  imported: typeof imported;
  stringUnion: typeof stringUnion;
  optional: typeof optional;
  deep: typeof deep;
  dog: typeof dog;
  iterable: typeof iterable;
  globalMerged: typeof globalMerged;
  boxed: typeof boxed;
  pair: typeof pair;
  withBases: typeof withBases;
  overlap: typeof overlap;
  intersectHeritage: typeof intersectHeritage;
  twoSpreadsType: typeof twoSpreadsType;
  ofInterfaceType: typeof ofInterfaceType;
  nestedSpreadType: typeof nestedSpreadType;
  overriddenType: typeof overriddenType;
  restType: typeof restType;
  partialHeritage: typeof partialHeritage;
  readonlyChild: typeof readonlyChild;
  renamed: typeof renamed;
  nested: typeof nested;
  aliased: typeof aliased;
  printed: typeof printed;
  reverseMapped: typeof reverseMapped;
  deepSpread: typeof deepSpread;
  statics: typeof statics;
  exportsOfNamespace: typeof exportsOfNamespace;
}
