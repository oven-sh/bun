// A class with fields it is born with and fields it is born without, constructed many times for the same new.target and for many.
export class Core {
  declare late?: unknown;
  count = 0;
  label: string | undefined = undefined;
  list: number[] | undefined;
  constructor(count?: number) {
    if (count !== undefined) this.count = count;
  }
  describe(): string {
    return this.count + " " + String(this.label) + " " + String(this.list) + " " + String(this.late);
  }
}
export const readLate = (core: Core): unknown => core.late;
export const fill = (core: Core, value: number): void => {
  core.label = "l" + value;
  core.list = [value];
  core.late = value;
};
