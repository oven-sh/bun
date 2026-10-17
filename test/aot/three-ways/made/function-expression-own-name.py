#!/usr/bin/env python3
"""function-expression-own-name.py <folder>: A sloppy, named function expression, evaluated once at the top level, whose `arguments` gets out, and its own name used from within in every place. Each folder: main.ts and shape.cjs."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
S = {
 'a01_control': 'exports.f = function named(n) { var args = arguments; return function () { return [named.name, args.length]; }; }; show(String(exports.f(1)()));',
 'a02_shadowed_by_a_parameter': 'exports.f = function named(n) { var args = arguments; return function (named) { return [typeof named, args.length]; }; }; show(String(exports.f(1)(5)));',
 'a03_shadowed_by_a_var_inside': 'exports.f = function named(n) { var args = arguments; return function () { var named = "mine"; return [named, args.length]; }; }; show(String(exports.f(1)()));',
 'a04_shadowed_by_the_outer_var': 'exports.f = function named(n) { var args = arguments; var named = "var"; return function () { return [named, args.length]; }; }; show(String(exports.f(1)()));',
 'a05_shadowed_by_its_own_parameter': 'exports.f = function named(named) { var args = arguments; return function () { return [named, args.length, args.callee === exports.f]; }; }; show(String(exports.f(1)()));',
 'a06_in_a_method_of_a_class': 'exports.f = function named(n) { var args = arguments; return class { m() { return [named.name, args.length]; } }; }; show(String(new (exports.f(1))().m()));',
 'a07_in_a_field_of_a_class': 'exports.f = function named(n) { var args = arguments; return class { x = [named.name, args.length]; }; }; show(String(new (exports.f(1))().x));',
 'a08_in_a_static_block': 'exports.f = function named(n) { var args = arguments; var got; class C { static { got = [named.name, args.length]; } } return got; }; show(String(exports.f(1)));',
 'a09_in_a_computed_key': 'exports.f = function named(n) { var args = arguments; return class { [named.name]() { return args.length; } }; }; show(String(new (exports.f(1))().named()));',
 'a10_in_extends': 'exports.f = function named(n) { var args = arguments; if (n === 0) return; return function () { return class extends named { }; }; }; show(String(Object.getPrototypeOf(exports.f(1)()) === exports.f));',
 'a11_in_a_default_parameter_of_an_inner': 'exports.f = function named(n) { var args = arguments; return function (x = named.name) { return [x, args.length]; }; }; show(String(exports.f(1)()));',
 'a12_in_its_own_default_parameter': 'exports.f = function named(n, x = named.name) { var args = arguments; return function () { return [x, args.length]; }; }; show(String(exports.f(1)()));',
 'a13_in_its_own_default_by_an_arrow': 'exports.f = function named(n, x = () => named.name) { var args = arguments; return [x(), args.length]; }; show(String(exports.f(1)));',
 'a14_in_a_getter': 'exports.f = function named(n) { var args = arguments; return { get g() { return [named.name, args.length]; } }; }; show(String(exports.f(1).g));',
 'a15_in_a_setter': 'exports.f = function named(n) { var args = arguments; var got; var o = { set s(v) { got = [named.name, args.length, v]; } }; o.s = 3; return got; }; show(String(exports.f(1)));',
 'a16_shorthand': 'exports.f = function named(n) { var args = arguments; return function () { return { named, args }; }; }; var r = exports.f(1)(); show(String([r.named === exports.f, r.args.length]));',
 'a17_typeof': 'exports.f = function named(n) { var args = arguments; return function () { return [typeof named, args.length]; }; }; show(String(exports.f(1)()));',
 'a18_stored_to_in_sloppy_code': 'exports.f = function named(n) { var args = arguments; return function () { named = 5; return [typeof named, args.length]; }; }; show(String(exports.f(1)()));',
 'a19_new': 'exports.f = function named(n) { var args = arguments; this.n = n; if (n > 0) this.more = function () { return new named(0); }; }; var o = new exports.f(1); show(String([o.more() instanceof exports.f, o.more().n]));',
 'a20_two_nested_both_show': 'exports.f = function outer(n) { var a = arguments; return function inner(m) { var b = arguments; return function () { return [outer.name, inner.name, a.length, b.length, a.callee === outer, b.callee === inner]; }; }; }; show(String(exports.f(1)(2, 3)()));',
 'a21_two_nested_the_inner_names_the_outer': 'exports.f = function outer(n) { var a = arguments; return function inner(m) { var b = arguments; return [outer.name, a.length, b.length]; }; }; show(String(exports.f(1)(2, 3)));',
 'a22_two_at_the_top_each_names_itself': 'exports.f = function one(n) { var a = arguments; return function () { return [one.name, a.length]; }; }; exports.g = function two(n) { var a = arguments; return function () { return [two.name, a.length, exports.f(1, 2)()]; }; }; show(String(exports.g(1)()));',
 'a23_the_same_name_twice': 'exports.f = function same(n) { var a = arguments; return function () { return [same === exports.f, a.length]; }; }; exports.g = function same(n) { var a = arguments; return function () { return [same === exports.g, a.length]; }; }; show(String([exports.f(1)(), exports.g(1, 2)()]));',
 'a24_in_a_generator': 'exports.f = function named(n) { var args = arguments; return function* () { yield named.name; yield args.length; }; }; show(String([...exports.f(1)()]));',
 'a25_in_an_async_function': 'exports.f = function named(n) { var args = arguments; return async function () { await 0; return [named.name, args.length]; }; }; exports.f(1)().then(function (v) { show(String(v)); });',
 'a26_itself_a_generator': 'exports.f = function* named(n) { var args = arguments; yield function () { return [named.name, args.length]; }; }; show(String(exports.f(1).next().value()));',
 'a27_in_a_catch_and_finally': 'exports.f = function named(n) { var args = arguments; return function () { try { throw 1; } catch (e) { return [named.name, args.length, e]; } finally { void named; } }; }; show(String(exports.f(1)()));',
 'a28_in_a_template_and_tag': 'exports.f = function named(n) { var args = arguments; if (Array.isArray(n)) return "tagged"; return function () { return [`${named.name}`, named`x`, args.length]; }; }; show(String(exports.f(1)()));',
 'a29_optional_call': 'exports.f = function named(n) { var args = arguments; if (n === 0) return "zero"; return function () { return [named?.(0), named?.name, args.length]; }; }; show(String(exports.f(1)()));',
 'a30_in_a_loop_body_closure': 'exports.f = function named(n) { var args = arguments; var out = []; for (let i = 0; i < 2; i++) out.push(function () { return [named.name, i, args.length]; }); return out; }; show(String(exports.f(1).map(function (g) { return g(); })));',
 'a31_destructuring_default': 'exports.f = function named(n) { var args = arguments; return function ({ x = named.name } = {}) { return [x, args.length]; }; }; show(String(exports.f(1)()));',
 'a32_as_an_argument_of_an_iife': '(function named(n) { var args = arguments; exports.g = function () { return [named.name, args.length, args.callee === named]; }; })(1); show(String(exports.g()));',
 'a33_in_a_const_at_the_top': 'const f = function named(n) { var args = arguments; return function () { return [named === f, args.length]; }; }; show(String(f(1)()));',
 'a34_in_an_array_at_the_top': 'var list = [function named(n) { var args = arguments; return function () { return [named === list[0], args.length]; }; }]; show(String(list[0](1)()));',
 'a35_with_direct_eval_inside': 'exports.f = function named(n) { var args = arguments; return function () { return [eval("named.name"), args.length]; }; }; show(String(exports.f(1)()));',
 'a36_arguments_of_the_inner_too': 'exports.f = function named(n) { var args = arguments; return function () { return [named.name, args.length, arguments.length]; }; }; show(String(exports.f(1)(1, 2, 3)));',
 'a37_callee_called': 'exports.f = function named(n) { var args = arguments; if (n === 0) return "end"; return function () { return [args.callee(0), named(0)]; }; }; show(String(exports.f(1)()));',
 'a38_properties_set_from_within': 'exports.f = function named(n) { var args = arguments; return function () { named.count = (named.count || 0) + 1; return [exports.f.count, args.length]; }; }; exports.f(1)(); show(String(exports.f(1)()));',
 'a39_three_deep_only_the_innermost_names_it': 'exports.f = function named(n) { var args = arguments; return function () { return function () { return function () { return [named.name, args.length]; }; }; }; }; show(String(exports.f(1)()()()));',
 'a40_in_a_label_and_switch': 'exports.f = function named(n) { var args = arguments; return function (k) { switch (k) { case named.length: return ["length", args.length]; default: return ["other"]; } }; }; show(String(exports.f(1)(1)));',
 'a41_in_an_object_method_with_super': 'exports.f = function named(n) { var args = arguments; return { __proto__: { m() { return "base"; } }, m() { return [super.m(), named.name, args.length]; } }; }; show(String(exports.f(1).m()));',
 'a42_bound_and_applied': 'exports.f = function named(n) { var args = arguments; return function () { return [named.bind(null).name, named.apply(null, [0]) === undefined || true, args.length]; }.bind(this); }; show(String(exports.f(0) && exports.f(1)()));',
}
for k, body in S.items():
    d = os.path.join(H, k); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'shape.cjs'), 'w').write('function show(s) { console.log(%r, s); }\n%s\n' % (k[:3], body))
    open(os.path.join(d, 'main.ts'), 'w').write('import "./shape.cjs";\n')
print(len(S), 'folders')
