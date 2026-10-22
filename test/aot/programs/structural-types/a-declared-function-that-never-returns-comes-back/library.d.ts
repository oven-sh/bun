export declare function fail(message: string): never;
export declare function assertNumber(value: unknown): asserts value is number;
export declare function assertPresent<T>(value: T): asserts value is NonNullable<T>;
export declare function assertTrue(condition: unknown): asserts condition;
export declare function isText(value: unknown): value is string;
export declare class Guard {
  stop(): never;
  check(value: unknown): asserts value is string;
  ready(): this is Ready;
}
export declare class Ready extends Guard {
  level: number;
}
export declare const impossible: never;
export declare function nothing(): void;
export declare function absent(): undefined;
export declare function nil(): null;
