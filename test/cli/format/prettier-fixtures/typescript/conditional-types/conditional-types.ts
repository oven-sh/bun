export type DeepReadonly<T> = T extends any[] ? DeepReadonlyArray<T[number]> : T extends object ? DeepReadonlyObject<T> : T;

type NonFunctionPropertyNames<T> = { [K in keyof T]: T[K] extends Function ? never : K }[keyof T];

interface DeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> {}

type DeepReadonlyObject<T> = {
    readonly [P in NonFunctionPropertyNames<T>]: DeepReadonly<T[P]>;
};

type TypeName<T> =
  T extends string ? "string" :
  T extends number ? "number" :
  T extends boolean ? "boolean" :
  T extends undefined ? "undefined" :
  T extends Function ? "function" :
  "object";

type Type01 = 0 extends (1 extends 2  ? 3 : 4) ? 5 : 6;
type Type02 = 0 extends ((1 extends 2  ? 3 : 4)) ? 5 : 6;
type Type03 = 0 extends (((1 extends 2  ? 3 : 4))) ? 5 : 6;
type Type04 = 0 extends ((((1 extends 2  ? 3 : 4)))) ? 5 : 6;
type Type05 = (0 extends 1 ? 2 : 3) extends 4 ? 5 : 6;
type Type06 = ((0 extends 1 ? 2 : 3)) extends 4 ? 5 : 6;
type Type07 = (((0 extends 1 ? 2 : 3))) extends 4 ? 5 : 6;
type Type08 = ((((0 extends 1 ? 2 : 3)))) extends 4 ? 5 : 6;

type T1 = () => void extends T ? U : V;
type T1a = () => (void extends T ? U : V);
type T1b = () => (void) extends T ? U : V;
type T2 = (() => void) extends T ? U : V;

type U1 = new () => X extends T ? U : V;
type U1a = new () => (X extends T ? U : V);
type U1b = new () => (X) extends T ? U : V;
type U2 = (new () => X) extends T ? U : V;
