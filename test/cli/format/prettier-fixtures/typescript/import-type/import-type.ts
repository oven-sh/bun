// ref: https://github.com/Microsoft/TypeScript/pull/22592

export const x: import("./foo") = { x: 0, y: 0 };

export let y: import("./foo2").Bar.I = { a: "", b: 0 };

export let shim: typeof import("./foo2") = {
    Bar: Bar2
};

export interface Foo {
    bar: import('immutable').Map<string, int>;
}

type X = A<import("B").C<any>>;
