const kTagHere = Symbol.for("test.tag");
export interface TaggedHere {
  n: number;
  [kTagHere]: string;
}
export function readHere(value: TaggedHere): string {
  return value[kTagHere] + value.n;
}
export function readLoosely(value: any): string {
  return value[kTagHere] + "|" + value[Symbol.for("test.tag")] + "|" + (kTagHere in value);
}
