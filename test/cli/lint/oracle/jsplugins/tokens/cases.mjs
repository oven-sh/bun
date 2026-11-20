// Inputs for the token tests. A name with an extension is a TypeScript case. `sourceType` defaults to "module".
export const isTypeScript = it => /\.tsx?$/.test(it.name);
export const fileOf = it => (isTypeScript(it) ? it.name : `${it.sourceType ?? "module"}/${it.name}.js`);

export const cases = [
  { name: "empty", code: "" },
  { name: "blank", code: " \n\t\n" },
  { name: "only-comments", code: "// a\n/* b */ /* c */\n" },
  { name: "hashbang", code: "#!/usr/bin/env node\na;\n" },
  { name: "one-token", code: "a" },
  { name: "statement", code: "var a = 1, b = [2, 3];" },
  { name: "comments-everywhere", code: "/*a*/f/*b*/(/*c*/x/*d*/,/*e*/y/*f*/)/*g*/;//h\n/*i*/" },
  { name: "adjacent-comments", code: "a;/*1*//*2*/ /*3*/\n//4\n//5\nb;" },
  { name: "no-space", code: "a=b+c*(d-e);f(g,h)" },
  { name: "wide-space", code: "a   =    b   ;\n\n\n   c  (  )  ;" },
  { name: "html-comments", sourceType: "script", code: "a; <!-- b\n--> c\nd;" },
  { name: "regex", code: "a = /b\\/[/]c/gu; d = e / f / g; h = /=/.test(i);" },
  { name: "template", code: "a = `b${c}d${`e${f}`}g`; h`i`; j = `k\n${/*l*/ m}`;" },
  { name: "literals", code: "a = [1n, 0x1F, 1e3, .5, 'b', \"c\", null, true, false, this];" },
  { name: "keywords-as-names", code: "a.if; ({ default: 1, let: 2, static: 3 }); class B { static async *get() {} }" },
  { name: "private", code: "class A { #b = 1; static #c() { return #b in this; } }" },
  { name: "escapes", code: "var \\u0061b, c\\u{64}; ({ tru\\u0065: 1 }); class A { #\\u0062; }" },
  { name: "astral", code: "a = '😀'; /* 😀 */ b = `😀${c}é`; // é\nd;" },
  { name: "line-breaks", code: "a;\r\nb;\rc; d; e; /* f\r\ng */ h;" },
  { name: "mark", code: "﻿a; // b\n" },
  { name: "jsx", code: '<a b="c &amp; d" e={f} {...g}>h &lt; i{/* j */}<k.l/> {m} </a>;' },
  { name: "jsx-line-breaks", code: "<a>\r\n  <b/>\r\n  c &#x41; \r\n</a>;" },
  { name: "jsx-names", code: '<a:b c-d="e"><this.f /><></></a:b>;' },
  { name: "arrow-generic.ts", code: "const a = <T,>(b: T): Array<Array<T>> => [[b]]; // c" },
  { name: "types.ts", code: "type A<B> = B extends `c${infer D}` ? D : never; /* e */ declare let f: A<'cg'>;" },
  {
    name: "class.ts",
    code: "abstract class A<T> implements B { private readonly c?: T; @d() e!: number; constructor(public f = 1) {} }",
  },
  { name: "escapes.ts", code: "var \\u0061b; class A { #\\u0062; }" },
  { name: "hashbang.ts", code: "#!/usr/bin/env bun\nenum A { B = 1 }\n" },
  { name: "element.tsx", code: '<a b="c &amp; d">e &lt; f\r\n{/* g */}<h<i> /></a>;' },
];
