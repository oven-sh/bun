export class Base {
  link?: Base; other?: Base | null; word?: string; any: unknown; flag?: boolean; count?: number; big?: bigint;
  declare run: (x: number) => number; declare twice: (x: number) => number; declare name: string | undefined;
  constructor(name?: string) { this.run = x => x + 1; this.twice = x => x * 2; this.name = name; }
}
