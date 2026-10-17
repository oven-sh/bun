export class Base {
  url: unknown = "/";
  next: Base | null = null;
  declare late?: unknown;
  declare count?: number;
  constructor(options: any) {
    if (options === "with count") this.count = 1;
  }
  describe(): string {
    return [String(this.url), String(this.late), String(this.count)].join();
  }
}
export class Full {
  first: unknown = 1;
  second: unknown = 2;
  constructor(_options: any) {}
  describe(): string {
    return [String(this.first), String(this.second)].join();
  }
}
