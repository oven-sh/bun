declare var n;

declare var m: string;

declare function fn1();

declare function fn2(n: string): number;

declare function fn3(n: string): number;
declare function fn4(n: number, y: number): string;

declare function fn5(x, y?);
declare function fn6(e?);
declare function fn7(x, y?, ...z);
declare function fn8(y?, ...z: number[]);
declare function fn9(...q: {}[]);
declare function fn10<T>(...q: T[]);

declare class cls {
    constructor();
    method(): cls;
    static static(p): number;
    static q;
    private fn();
    private static fns();
}
