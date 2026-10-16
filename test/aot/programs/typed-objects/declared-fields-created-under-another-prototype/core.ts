export class Core {
  declare first: unknown;
  declare second: Function | undefined;
  declare third?: number;
  declare fourth?: string;
  always = "always";
  constructor(options: any) {
    this.first = options;
    this.second = () => options;
    if (options !== 0) this.third = 3;
  }
  later(value: string) {
    this.fourth = value;
  }
  describe(): string {
    return [String(this.first), typeof this.second, String(this.third), String(this.fourth), this.always].join();
  }
}
export var Valued = class {
  declare one: unknown;
  declare two?: unknown;
  constructor(options: any) {
    this.one = options;
    this.fill = (value: unknown) => {
      this.two = value;
    };
  }
  declare fill: (value: unknown) => void;
};
