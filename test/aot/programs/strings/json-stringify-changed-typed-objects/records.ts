export interface Point {
  x: number;
  y: number;
  label?: string;
  tag?: unknown;
}

export interface Line {
  from: Point;
  to: Point;
  points: Point[];
}

export class Account {
  id: number;
  owner: string;
  #secret = "hidden";
  describe = () => `${this.owner}#${this.id}${this.#secret.length}`;
  constructor(id: number, owner: string) {
    this.id = id;
    this.owner = owner;
  }
  get summary(): string {
    return this.describe();
  }
}

export class Money {
  constructor(
    public amount: number,
    public currency: string,
  ) {}
  toJSON(): string {
    return `${this.amount} ${this.currency}`;
  }
}

export class Wallet {
  constructor(
    public owner: string,
    public balance: Money,
  ) {}
}

export function point(x: number, y: number): Point {
  return { x, y };
}

export function labeled(x: number, y: number, label: string | undefined): Point {
  return { x, y, label };
}

export function line(): Line {
  return { from: point(0, -0), to: labeled(1.5, NaN, "end"), points: [point(1, 2), labeled(3, Infinity, undefined)] };
}
