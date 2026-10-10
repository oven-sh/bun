// Names, heads and overloads of members and functions.
const key = 'k', sym = Symbol.for('s');
let once = 'o';
class A {
  constructor();
  constructor(private a?: number, @d() public readonly b = 1, @d @e protected c?: string) {}
  'constructor'() {}
  static constructor() {}
  ['constructor']() {}
  [`t`]() {}
  [`t${key}`] = 1;
  [key](): void;
  [key]() {}
  [sym]() {}
  [Symbol.iterator](): void;
  [Symbol.iterator]() {}
  [once] = () => {};
  [a.b]() {}
  [a()](): void;
  [b()]() {}
  [null] = 1;
  [true] = 1;
  [/r/g] = 1;
  [1n] = 1;
  [0x10] = 1;
  1e3 = 1;
  0x10n = 1;
  'a-b' = 1;
  'ab' = 1;
  #p = 1;
  get #q() { return 1; }
  @d @e() static async *gen<T extends (a: 1) => 2>(x: T) {}
  @d accessor acc = function () {};
  @d prop = function <T>(x: T) {};
  @d() static arrow = async <T,>(x: T) => x;
  one = x => x;
  two = (x, y) => x;
  none = () => 1;
  trailing = (x,) => x;
  typed = (x: number) => x;
  rest = (...x) => x;
  dflt = (x = 1) => x;
  abstract m(): void;
  declare z: number;
  static {}
  [k: string]: unknown;
}
abstract class B {
  abstract get x(): number;
  abstract set x(v: number);
  abstract y: number;
  abstract accessor w: number;
}
interface I {
  (): void;
  new (): I;
  m(): void;
  get g(): number;
  set g(v: number);
  p: () => void;
  [`t`]: 1;
  ['s']: 1;
  [k: string]: unknown;
  [...r]: unknown;
}
const o = {
  m() {}, get g() { return 1; }, set g(v) {}, async *ag() {}, f: function () {}, n: function named<T extends (a: 1) => 2>() {},
  a: () => {}, [key]: x => x, [`t`]: 1, [function () {}]: 1, ...s, sh, 'q-r': 1, 1: 2, 1n: 3,
};
function g1(): void;
function g1() {}
export function g2(): void;
export function g2() {}
function g3() {}
export function g3x(): void;
declare function g4(): void;
function g4() {}
namespace N {
  function h(): void;
  function h() {}
  export function i(): void;
  export function i() {}
}
function p({ [x => x]: a = y => y, [function () {}]: b }) {}
type U = | A | (() => void) | (new () => A) | (A extends B ? 1 : 2) | (| A | B) | (& A & B) | A[];
type V = & A & (A | B) & (& A & B);
@d export class C {}
@d({ a: [1] }) export default class D {}
