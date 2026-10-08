const t1 = { a: 1 } satisfies I1;
const t2 = { a: 1, b: 1 } satisfies I1;
const t3 = { } satisfies I1;
const t4: T1 = { a: "a" } satisfies T1;
const t5 = (m => m.substring(0)) satisfies T2;
const t6 = [1, 2] satisfies [number, number];
let t7 = { a: 'test' } satisfies A;
let t8 = { a: 'test', b: 'test' } satisfies A;

const p = {
  isEven: n => n % 2 === 0,
  isOdd: n => n % 2 === 1
} satisfies Predicates;

let obj: { f(s: string): void } & Record<string, unknown> = {
    f(s) { },
    g(s) { }
} satisfies { g(s: string): void } & Record<string, unknown>;

({ f(x) { } }) satisfies { f(s: string): void };

const car = {
    start() { },
    move(d) {
        // d should be number
    },
    stop() { }
} satisfies Movable & Record<string, unknown>;

var v = undefined satisfies 1;
