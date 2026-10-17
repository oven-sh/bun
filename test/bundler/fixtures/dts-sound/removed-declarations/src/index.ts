import * as alias from "./alias";
import * as keys from "./keys";
import { Annotated, Checked, Prefixed, TypeId, Version } from "./keys";
const LocalId = "~fixture/Local";
export interface Cache {
  readonly [TypeId]: typeof Version;
  readonly [Prefixed]?: string;
  readonly [Checked]?: boolean;
  readonly [Annotated]?: Annotated;
  readonly [LocalId]?: typeof LocalId;
  readonly [keys.marker]?: true;
  readonly [keys.missing]?: false;
}
export interface Aliased {
  readonly [alias.TypeId]: 3;
}
export type Lookup = (key: string) => string | typeof alias.absent;
export type Tools = { canonical: typeof keys.canonical; measure: typeof keys.measure; unused: keys.Unused };
export class MemoryCache implements Cache, Aliased {
  readonly "~fixture/Cache" = 3;
}
export function make(): Cache {
  return new MemoryCache();
}
