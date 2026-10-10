const a: Foo = () => {}, b = (() => {}) as Foo, c = <Foo>function () {}, d = (() => {}) satisfies Foo;
const e: Foo = { p: () => {}, q: { r() {}, s: function () {} }, get t() { return 1; }, set u(v) {}, [() => {}]: 1 };
foo(() => {}); foo?.(() => {}); new Foo(() => {}); (() => {})(); new (function () {})(); foo(...[() => {}]); foo({ a: () => {} });
function f(a: Foo = () => {}, b = () => {}, { c = () => {} }: Foo = {}, [d = () => {}] = []) {}
class K { a: Foo = () => {}; b = () => {}; accessor c: Foo = () => {}; static d: Foo = function () {}; @(() => {}) e: Foo; [(() => {})()]: Foo; constructor(private x: Foo = () => {}) {} set s(v) {} get g() { return 1; } static constructor() {} }
export default () => {};
export const h = () => () => {}, i = () => function () {}, j = () => { return () => {}; }, k = () => { if (x) return () => {}; return 1; }, l = () => {};
const m = () => ({}) as const, n = () => <const>{}, o = () => ({}) as const satisfies Foo, p = () => ({}) satisfies Foo as const;
function q(): Foo { return () => {}; } function r() { return (): Foo => () => {}; } const s: Foo = () => () => {}; const t = () => () => {};
const u = { a: () => 1, b: () => { return 1; } }; const v: Foo = { a: () => 1 }; function w(): Foo { return { a: () => 1 }; }
class L { a: Foo = () => () => {}; b = () => () => {}; m(): Foo { return () => {}; } }
x = () => () => {}; for (x = () => () => {}; ;) {} function y(): Foo { for (z = () => () => 1; ;) {} x = () => () => 1; }
async function* z1<T extends (a: number) => void>() {} const z2 = async <T>(a: T) => {}; const z3 = async a => {}; const z4 = (a) => {}; const z5 = function* named() {};
export function z6() {} export default function () {} export async function z7() {}
class M { @dec() public static async *m() {} @dec() p = () => {}; @dec() q = (a, b) => {}; private 'quoted'() {} [computed]() {} }
void (() => {}), [() => {}], cond ? () => {} : function () {};
