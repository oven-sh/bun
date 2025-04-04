type IfEquals<T, U, Y = true, N = false> = (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2 ? Y : N;

export function expectType<T>(): {
  /**
   * @example
   * ```ts
   * expectType<number>().is<1>(); // fail
   * expectType<number>().is<any>(); // fail
   * expectType<any>().is<number>(); // fail
   * expectType<number>().is<unknown>(); // fail
   * expectType<number>().is<number>(); // pass
   * expectType<Uint8Array>().is<Uint8Array>(); // pass
   * ```
   */
  is<X extends T>(...args: IfEquals<X, T> extends true ? [] : [expected: X, butGot: T]): void;
};
export function expectType<T>(arg: T): {
  /**
   * @example
   * ```ts
   * expectType(my_number).is<1>(); // fail
   * expectType(my_number).is<any>(); // fail
   * expectType(my_any).is<number>(); // fail
   * expectType(my_number).is<unknown>(); // fail
   * expectType(my_number).is<number>(); // pass
   * expectType(my_Uint8Array).is<Uint8Array>(); // pass
   * ```
   */
  is<X extends T>(...args: IfEquals<X, T> extends true ? [] : [expected: X, butGot: T]): void;
};
export function expectType<T>(arg?: T) {
  return { is() {} };
}

export declare const expectAssignable: <T>(expression: T) => void;
export declare const expectNotAssignable: <T>(expression: any) => void;
export declare const expectTypeEquals: <T, S>(expression: T extends S ? (S extends T ? true : false) : false) => void;
