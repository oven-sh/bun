// #18478

abstract class AbstractBar {
  abstract method4(
    param1: number,
    // trailing line comment
  ): void;
  abstract method5(
    param1: number,
    /* trailing block comment */
  ): void;
  abstract method6(
    ...rest: number[]
    // trailing after rest
  ): void;
  abstract method7(
    { a }: { a: number },
    // trailing after object pattern
  ): void;
}

declare class DeclareCls {
  method(
    param1: number,
    // trailing line after last param
  ): void;
}

class Overload {
  method(
    param1: number,
    // trailing line on first overload
  ): void;
  method(param1: string): void;
  method(param1: number | string): void {}
}
