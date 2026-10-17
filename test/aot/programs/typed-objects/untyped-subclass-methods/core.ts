// A class with declared fields that code without types extends. What the heirs' prototype objects hold decides what is found where a field is absent.
export class Core {
  declare first?: unknown;
  declare second?: unknown;
  declare late?: unknown;
  always = 1;
  constructor(given?: { first?: unknown; second?: unknown }) {
    if (given && given.first !== undefined) this.first = given.first;
    if (given && given.second !== undefined) this.second = given.second;
  }
  area(): number {
    return 2;
  }
  get size(): number {
    return 3;
  }
  describe(): string {
    return "area " + this.area() + " size " + this.size + " first " + String(this.first) + " second " + String(this.second);
  }
  setLate(value: unknown): void {
    this.late = value;
  }
}
export interface Other {
  elsewhere?: unknown;
  always: number;
}
export const makeOther = (): Other => ({ elsewhere: "of Other", always: 2 });
export const readFirst = (core: Core): unknown => core.first;
export const readSecond = (core: Core): unknown => core.second;
export const readLate = (core: Core): unknown => core.late;
export const hasFirst = (core: Core): boolean => "first" in core;
export const hasLate = (core: Core): boolean => "late" in core;
export const storeFirst = (core: Core, value: unknown): void => {
  core.first = value;
};
export const storeSecond = (core: Core, value: unknown): void => {
  core.second = value;
};
export const readElsewhere = (either: Core | Other): unknown => ("elsewhere" in either ? "in it" : "not in it");
export const readElsewhereOf = (other: Other): unknown => other.elsewhere;
export const callArea = (core: Core): number => core.area();
export const readSize = (core: Core): number => core.size;
export const inText = (core: Core): string => `${core}`;
export const asJSON = (core: Core): string => JSON.stringify(core);
export const resolved = async (core: Core): Promise<unknown> => await core;
export const resolvedBy = (core: Core): Promise<unknown> => Promise.resolve(core);
export const spread = (core: Core): unknown[] => {
  try {
    return [...(core as unknown as Iterable<unknown>)];
  } catch (error) {
    return [(error as Error).constructor.name];
  }
};
export const keysOf = (core: Core): string => Object.keys(core).join();
