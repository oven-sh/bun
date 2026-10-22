export declare class Account {
  balance: number;
  constructor(balance: number);
  deposit(amount: number): number;
}
export declare class Frozen {
  size: number;
}
export declare class Lazy {
  items: number[];
}
export declare function makeList(): number[];
export declare function makeMap(): Map<string, number>;
export declare function makePromise(): Promise<number>;
