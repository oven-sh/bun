// Small inputs in every language that `bun format` reads, with line breaks wherever they mean something: in comments, in
// `prettier-ignore`d code, in strings, templates and block scalars, in embedded code, between things that keep an empty line.
// They are written with \n. `format.test.ts` gives them other line breaks and a byte order mark.
export const inputs: Record<string, string> = {
  "js-ignore.js":
    "// prettier-ignore\nconst a = [\n  1,0,\n  0,1\n];\nclass A {\n  // prettier-ignore\n  m( a,\n     b ) {}\n}\nconst o = {\n  // prettier-ignore\n  k:   [1,\n  2],\n  z: 1\n};\n",
  "js-template.js":
    "const a = `x\n  y\n${ b }\n z`;\nfoo(`a\nb`, c);\nconst s = `${a}\n`;\nx = `\n`;\nfoo(`line1\n  ${veryLongExpressionNumberOne + veryLongExpressionNumberTwo + veryLongExpressionNumberThree}\n`);\n",
  "js-string-cont.js":
    "'use strict\\\n more';\nconst a = 'x\\\ny';\nconst b = \"it's\\\nz\";\nconst c = 'say \"hi\"\\\nz';\n",
  "js-comments.js":
    "/**\n * doc\n   * bad indent\n */\nfunction a() {}\n/*\n  not\n    indentable\n*/\nfunction b() {\n  /*\n   keep\n     this */\n  return 1; // trailing   \n}\n\n\n// two blank lines above\nlet x = /* a\n b */ 1;\n",
  "js-blank-lines.js":
    "a;\n\n\nb;\nfoo(\n  a,\n\n  b,\n);\nconst o = {\n  a: 1,\n\n\n  b: 2,\n};\nconst p = { a: 1,\n b: 2 };\nswitch (x) {\n  case 1:\n\n    a;\n\n  case 2:\n    b;\n}\nclass C {\n  a = 1;\n\n  b = 2;\n  m() {}\n\n\n  n() {}\n}\nconst arr = [\n  1,\n\n  2,\n];\n",
  "js-shebang.js": "#!/usr/bin/env node\n\n'use strict';\n\nfoo();\n",
  "js-shebang2.js": "#!/usr/bin/env node\n// c\nfoo();\n",
  "js-jsx.jsx":
    'const a = (\n  <div\n    title="a\n  b"\n  >\n    text one\n    text two{" "}\n    {/* c\n     d */}\n\n    <b>x</b>\n\n\n    tail\n  </div>\n);\nconst b = <a>\n  {`x\n y`}\n</a>;\n',
  "js-jsx-ignore.jsx":
    'const a = (\n  <div>\n    {/* prettier-ignore */}\n    <b   x = "1"\n       y />\n    <c\n      // prettier-ignore\n      style  =  {{a:1,\n  b:2}}\n    />\n  </div>\n);\n',
  "js-each.js":
    "describe.each`\n  a    | b | expected\n  ${1} | ${1}   | ${2}\n  ${11111} | ${1} | ${22222}\n`('$a + $b', () => {});\n",
  "js-css.js": "const A = styled.div`\n  color:red;\n\n  ${x};\n  margin: 0\n`;\nconst B = css`\n  a{b:c}\n`;\n",
  "js-graphql.js": "const q = gql`\n  query { a\n\n  b }\n\n  ${frag}\n`;\nconst r = graphql(schema, `\n{ a }\n`);\n",
  "js-html.js":
    "const h = html`\n<div><span>a</span>\n\n<p>${x}</p></div>\n`;\nconst i = /* HTML */ `<a\nhref=x>y</a>`;\n",
  "js-markdown.js": "const m = markdown`\n  # a\n\n  * b\n  * c\n`;\nconst n = md`\n  x\n  ===\n`;\n",
  "js-member-chain.js":
    "a\n  .b()\n\n  .c()\n  // c\n  .d();\nwrapper.find('SomeSelector').prop('children')(`a\nb`).foo();\n",
  "js-simple-template-arg.js":
    "const x = object.foo.bar.baz.qux(`abc\ndef`).something().another().last();\nfoo.bar.baz(`a${b}\nc`).d().e().f();\n",
  "js-object-first-key.js":
    "const a = {\n  b: 1 };\nconst c = { d: 1,\n};\nfunction f({\n  a, b }) {}\ntype;\nconst {\n  x } = y;\n",
  "ts-object-first-key.ts":
    "type A = {\n  b: 1 };\ninterface B { c: 1,\n d: 2 }\ntype M = {\n  [K in T]: 1 };\ntype N = { [K in T]:\n 1 };\nenum E {\n A, B }\n",
  "ts-ignore.ts":
    "type A =\n  // prettier-ignore\n  | { a:   1,\n   b: 2 }\n  | B;\ninterface I {\n  // prettier-ignore\n  a:   1;\n  b:   2;\n}\n// prettier-ignore\ntype X = [\n 1,2,\n 3];\n",
  "ts-comments.ts":
    "function f(\n  a: string, // first\n  // own line\n  b: number,\n) {}\nconst x = {\n  a, // t\n  /* l */ b,\n};\nif (a) {\n  // only\n}\nelse {\n  b; // x\n}\n",
  "ts-decorators.ts":
    "@A()\n@B()\nclass C {\n  @D() x;\n  @E()\n  y;\n  @F() @G()\n  z() {}\n}\nexport @H class I {}\n@J\nexport class K {}\n",
  "js-return-comment.js":
    "function f() {\n  return (\n    // c\n    a\n  );\n}\nfunction g() {\n  return /* a\n  b */ x;\n}\nthrow (\n  // c\n  e\n);\n",
  "js-arrow-chain.js": "const f = (a) =>\n  // c\n  (b) => c;\nfoo(a => {\n\n  b;\n\n});\n",
  "js-directive.js": "'use strict'\n\n\n'other';\n// c\n\nfoo;\nfunction f() {\n  'use strict';\n\n  a;\n}\n",
  "js-only-comment.js": "// a\n\n\n// b\n",
  "js-only-block.js": "/* a\n b */\n",
  "js-regex-class.js": "const r = /[\\r\\n]/;\nconst s = '\\r\\n';\nconst t = `\\r\\n`;\n",
  "js-binary-comment.js": "const a =\n  b && // c\n  d;\nconst e = f\n  // g\n  + h;\n",
  "js-if-else-comment.js": "if (a) b;\n// c\nelse d;\nif (a) {\n} // x\nelse {\n}\n",
  "js-long-string-concat.js":
    "const a = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +\n  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' +\n  `c\nd`;\n",
  "css-basic.css": '@charset "utf-8";\n\n\na{color:red;\n\n\nbackground:blue}\n/* c\n   d */\n\nb,\nc{d:e}\n',
  "css-ignore.css":
    "a {\n  /* prettier-ignore */\n  b:   c\n    d;\n  e:   f;\n}\n/* prettier-ignore */\n.x   >   y {\n  a:b\n}\n",
  "css-string.css": 'a{content:"x\\\ny";b:url(\n  a.png\n)}\n',
  "css-custom.css": ":root{--a:{\n  b:c;\n};--d:   e\n  f;--empty:;--j: [\n 1,\n 2 ]}\n",
  "css-media.css":
    '@media (min-width:100px)\n  and (max-width:200px){a{b:c}}\n@import url("a.css")\n  screen;\n@supports (a:b)\n or (c:d){e{f:g}}\n',
  "css-grid.css":
    'a{grid-template-areas:\n  "a b"\n  "c d";\ngrid-template-columns:\n  [full-start] minmax(1em, 1fr)\n  [main-start] minmax(0, 40em)\n  [main-end];grid:\n a\n b}\n',
  "css-front.css": "---\ntitle: x\n---\na{b:c}\n",
  "css-comment-end.css": "a{b:c}/* x */\n/* y */",
  "css-selector-comment.css": "a, /* x\n y */\nb{c:d}\na\n>\nb\n~\nc{d:e}\n",
  "css-value-comma.css":
    "a{transition:opacity .3s ease,\n  transform .3s ease;font-family:a,\nb,\n c;mask:\n url(a.png)\n no-repeat}\n",
  "scss-basic.scss":
    "// c   \n$a:1;\n\n\n$m:(\n  a:1,\n  b:2\n);\n@mixin x($a,\n  $b){c:d}\n.a{&-b{c:d}\n\n  // e\n  @include x(1,\n 2);\n}\n@if $a==1{b{c:d}}\n@else{e{f:g}}\n",
  "scss-comment.scss": "a{\n  // x\n  b:c; // y\n  /* z\n  w */\n  d:e\n}\n// last",
  "scss-string.scss": "$a:\"x\\\ny\";\n@debug \"a\n b\";\n$s: 'a' +\n 'b';\n",
  "scss-each.scss":
    '@each $a,\n  $b in (a:1,\n b:2){c{d:e}}\n@function f($a){@return $a\n + 1;}\n@use "a" with (\n  $b: 1,\n  $c: 2\n);\n',
  "scss-placeholder.scss": "%a{b:c}\n.d{@extend %a;\n\n\n}\n",
  "less-basic.less":
    '// c\n@a:1;\n.m(@a;\n  @b){c:d}\n.x{.m(1;\n 2);\n  &:extend(.y all);\n}\n@r:{a:b;\n};\n@plugin "x";\n.g when (@a>1)\n  and (@b<2){c:d}\n@s:~"a\n b";\n@j:`a\n b`;\n',
  "less-comment.less": 'a{\n  // x\n  b:c; // y\n}\n// z\n@import (reference)\n  "a";\n',
  "json-basic.json": '// c\n{"a":1,\n\n\n"b":[1,\n\n2],/* x\n y */"c":{}}\n',
  "json-ignore.json": '{\n  // prettier-ignore\n  "a":   [1,\n   2],\n  "b":   1\n}\n',
  "json-string.json5": "{a:'x\\\ny',b:\"z\"}\n",
  "json-first-key.json": '{\n"a":1}\n',
  "json-first-key2.json": '{"a":1,\n"b":{\n"c":1},"d":{"e":1\n}}\n',
  "yaml-block.yaml":
    "a: |\n  x\n   y\n\n  z\n\nb: >\n  x\n  y\n\n  z\nc: |+\n  x\n\n\nd: |-\n  x\n\ne: >-\n  long long\n  text\n\n    indented\nf: |2\n    x\n",
  "yaml-flow.yaml":
    "a: x\n  y\n\n  z\nb: \"x\n  y\n\n  z\\\n  w\"\nc: 'x\n  y'\nd: [a,\n  b,\n\n  c]\ne: {a: 1,\n  b: 2}\n",
  "yaml-comments.yaml": "# a   \n\n\n# b\na: 1 # c\n# d\nb:\n  # e\n  - 1\n\n\n  - 2 # f\n",
  "yaml-ignore.yaml": "# prettier-ignore\na:   [1,\n   2]\nb:   [1,\n   2]\nc:\n  # prettier-ignore\n  d:    1\n",
  "yaml-docs.yaml": "%YAML 1.2\n---\na: 1\n...\n---\n# c\nb: 2\n---\n",
  "yaml-anchor.yaml": "a: &x\n  b: 1\nc: *x\nd: !!str\n  e\n? complex\n  key\n: v\n",
  "yaml-long.yaml":
    "a: aaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbb cccccccccccccccccccc dddddddddddddddddddd eeeeeeeeeeeeeee fffffffff\nb: >\n  aaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbb cccccccccccccccccccc dddddddddddddddddddd eeeeeeeeeeeeeee fffffffff\n",
  "yaml-trailing-space.yaml": "a: |  \n  x  \n  y\t\nb: 1   \n",
  "md-basic.md":
    "# a\n\n\ntext  \nhard break\\\nagain\nsoft\n\n* a\n* b\n\n    code\n     more\n\n```js\nconst a  =  1;\n\n\nb\n```\n\nSetext\n===\n\n> q\n> r\n\n---\n",
  "md-table.md": "| a | b |\n|---|:-:|\n| 1 | 2 |\n| long cell | x |\n",
  "md-html.md": "<div>\n  <b>x</b>\n\n</div>\n\n<!-- c\n d -->\n\ntext <span\nclass=x>y</span>\n",
  "md-ignore.md":
    "<!-- prettier-ignore -->\n| a | b |\n|--|--|\n| 1 | 2 |\n\n<!-- prettier-ignore-start -->\n*  a\n*  b\n\n+ c\n<!-- prettier-ignore-end -->\n\n*  d\n",
  "md-front.md": "---\na:   1\nb:\n  - x\n---\n\n# t\n",
  "md-front-toml.md": "+++\na = 1\n+++\n\n# t\n",
  "md-front-empty.md": "---\n---\n\n# t\n",
  "md-code-langs.md":
    '```css\na{b:c}\n```\n\n```json\n{"a":1,\n"b":2}\n```\n\n```yaml\na:   1\n```\n\n```ts\nconst a = `x\ny`;\n```\n\n```\nraw  \n\n```\n\n~~~sh\nx\n~~~\n',
  "md-list.md": "1. a\n\n   b\n2. c\n   - d\n\n     e\n\n\n- [ ] t\n- [x] u\n",
  "md-link-ref.md": '[a]: http://x\n  "t"\n[b]:\n  http://y\n\n[a] [b]\n\n[^1]: note\n    more\n\nx[^1]\n',
  "md-math.md": "$$\na\n b\n$$\n\ninline $x$\n",
  "md-liquid.md": "{% a\n b %}\n\n{{ x\n y }}\n",
  "md-inline-code.md": "`a\nb` and ``c\n d``\n",
  "md-emphasis.md": "*a\nb* __c\nd__ [l\nm](x) ![i\nj](y)\n",
  "md-trailing-ws.md": "a   \n\n   \nb\t\n",
  "md-no-final-newline.md": "a\n\nb",
  "md-blockquote-code.md": "> ```js\n> a  =  1\n> ```\n>\n> - x\n>   y\n",
  "md-html-pre.md": "<pre>\na\n\n b\n</pre>\n\n<script>\nx\n\ny\n</script>\n",
  "md-entity.md": "a&#13;b &#10; c&#xD;\n",
  "gql-basic.graphql":
    '# c   \nquery A($a:Int,\n  $b:Int){a\n\n\nb(x:1,\n y:2)# t\n}\n\n\n"""\ndoc\n  more\n"""\ntype T{\n  "d"\n  a:Int\n\n  """ x """\n  b:Int\n}\n',
  "gql-ignore.graphql": "# prettier-ignore\nquery   A {\n  a,\n   b\n}\n\nquery   B { a }\n",
  "gql-block-string.graphql":
    'type T {\n  """\n    a\n\n      b\n  """\n  f(a: String = """\n  x\n   y\n  """): Int\n}\n',
  "gql-union.graphql": "union U =\n  | A\n  | B\ninterface I implements A &\n B { a: Int }\nenum E {\n A\n\n B }\n",
  "hbs-basic.hbs":
    '<div class="a\n  b"   id=x>\n  {{foo}}\n\n\n  text\n  more {{bar\n  a=1}}\n  {{!-- c\n   d --}}\n  {{! e\n f }}\n</div>\n{{#if a}}\n  b\n{{else}}\n\n  c\n{{/if}}\n',
  "hbs-string.hbs": '{{foo "a\nb" c=\'d\ne\'}}\n<a title="{{x}}\n y"></a>\n',
  "hbs-ignore.hbs": '{{! prettier-ignore }}\n<div   a="b"\n   c>\n</div>\n<div   a="b"\n   c>\n</div>\n',
  "hbs-ws.hbs": "a\n\n\n\nb   \n{{~c~}}\n  d\n",
  "hbs-entity.hbs": "<p>a&#13;&#10;b &nbsp; c</p>\n",
  "hbs-front.hbs": "---\na: 1\n---\n<p>x</p>\n",
  "html-basic.html":
    "<!DOCTYPE html>\n<html>\n<head>\n<title>x</title>\n<style>\na{b:c}\n\n\nd{e:f}\n</style>\n<script>\nconst a  = `x\ny`;\n\n\nb()\n</script>\n</head>\n<body>\n<p>a\nb</p>\n\n\n<p>c</p>\n</body>\n</html>\n",
  "html-pre.html":
    "<pre>\na\n\n  b\n</pre>\n<pre>a\nb</pre>\n<pre>\n\na</pre>\n<textarea>\n x\n y</textarea>\n<div><pre>\n  x\n</pre></div>\n<listing>\na\n</listing>\n",
  "html-ignore.html":
    '<!-- prettier-ignore -->\n<div   a="b"\n   c>\n  x\n</div>\n<div   a="b"\n   c>\n  x\n</div>\n<!-- prettier-ignore-attribute -->\n<div   (click)="a\n b"  c="d"></div>\n',
  "html-comment.html": "<!-- a\n  b\n    c -->\n<div><!-- x\n y --></div>\n<!--[if IE]>\n<p>x</p>\n<![endif]-->\n",
  "html-attr.html":
    '<div class="a\n  b\n c" style="color:red;\n background:blue" title="x\n  y" data-x=\'a\nb\'></div>\n<img srcset="a.png 1x,\n b.png 2x" sizes="(max-width:1px) 1px,\n 2px">\n<a href="x\n y">z</a>\n',
  "html-script-types.html":
    '<script type="text/template">\n  <div>\n   x\n  </div>\n</script>\n<script type="application/json">\n{"a":1,\n"b":2}\n</script>\n<script type="module">\nimport a from \'a\'\n</script>\n<script type="text/markdown">\n# a\n* b\n</script>\n<script type="unknown">\n  raw\n    text\n</script>\n<script type="importmap">\n{"imports":{}}\n</script>\n',
  "html-inline.html": "<span>a</span>\n<span>b</span><b>c</b>\n<i>d\n</i>\n<button>\n  x\n</button>\ntext\n\ntext2\n",
  "html-front.html": "---\na: 1\n---\n<p>x</p>\n",
  "html-cdata.html": "<svg><![CDATA[\n a\n  b\n]]></svg>\n<?xml a\n b?>\n",
  "html-entity.html": '<p>a&#13;&#10;b&#xd;c</p>\n<p title="a&#13;b">x</p>\n',
  "html-unclosed.html": "<ul>\n<li>a\n<li>b\n</ul>\n<p>x\n<p>y\n",
  "html-style-media.html":
    '<style media="a\n b">\n  a{b:c}\n</style>\n<style lang="scss">\n// x\na{b{c:d}}\n</style>\n<style type="text/unknown">\n  raw\n</style>\n',
  "html-event.html": '<button onclick="a();\n b()">x</button>\n',
  "vue-basic.vue":
    '<template>\n  <div :a="b\n  + c" @click="d();\n e()" v-for="x in\n y" v-if="a &&\n b">\n    {{ a\n    + b }}\n\n\n    text\n  </div>\n</template>\n\n\n<script>\nexport default {\n  a: `x\ny`,\n\n\n  b: 1\n}\n</script>\n\n<style scoped>\na{b:c}\n</style>\n',
  "vue-custom.vue":
    '<i18n>\n{"a":1,\n"b":2}\n</i18n>\n<custom lang="json">\n{"a":1,\n"b":2}\n</custom>\n<docs>\n# a\n  raw\n</docs>\n<custom lang="yaml">\na:   1\n</custom>\n<template lang="pug">\ndiv\n  p x\n</template>\n',
  "vue-setup.vue":
    '<script setup lang="ts">\nconst a = defineProps<{\n  a: string }>()\n// c\n\n\nconst b = 1\n</script>\n<template>\n  <pre>\n a\n  b\n</pre>\n  <textarea>\nx</textarea>\n</template>\n',
  "vue-ignore.vue":
    '<template>\n  <!-- prettier-ignore -->\n  <div   a="b"\n     c />\n  <div   a="b"\n     c />\n</template>\n<!-- prettier-ignore -->\n<script>\nconst a   =  1\n  b\n</script>\n',
  "vue-style-langs.vue":
    '<style lang="scss">\n// c\n$a:1;\n.a{.b{c:$a}}\n</style>\n<style lang="less">\n// c\n@a:1;\n</style>\n<style lang="stylus">\na\n  b c\n</style>\n<style lang="postcss">\na{b:c}\n</style>\n',
  "vue-slot.vue":
    '<template>\n  <a v-slot="{ b,\n c }" #d="{\n e }" v-bind:f.sync="g\n" :class="{\n a: b }" :style="[a,\n b]" />\n</template>\n',
  "k-template-key.js": "const o = { [`a\nb`]: 1, c: 2 };\nclass A { [`a\nb`] = 1; [`c\nd`]() {} }\n",
  "k-template-type.ts": "type A = `a\nb`;\ntype B = `a${C}\nb`;\nlet x: `a\n  b` = y;\ntype D = { [`a\nb`]: 1 };\n",
  "k-import-attr.js":
    "import a from 'a\\\nb' with { type: 'js\\\non' };\nexport * from \"c\\\nd\";\nimport('e\\\nf');\n",
  "k-comment-places.ts":
    "function f</* a\n b */ T>(/* c\n d */) {}\nconst x = `${/* e\n f */ y}`;\nconst z = <T,/* g\n h */>() => {};\nfoo(/* i\n * j\n */);\nlet a: /* k\n l */ string;\n",
  "k-comment-jsx.jsx":
    "const a = <div /* a\n b */ c /* d */>\n  {/* e\n   * f\n   */}\n  {\n    // g\n  }\n  {x /* h\n i */}\n</div>;\n",
  "k-ignore-many.ts":
    "switch (a) {\n  // prettier-ignore\n  case   1:\n    b  ;\n  case 2:\n    // prettier-ignore\n    c   (\n  d);\n}\n// prettier-ignore\nexport const   e = [\n 1,2];\nexport default {\n  // prettier-ignore\n  f:   [\n 1,2],\n};\nclass G {\n  // prettier-ignore\n  @dec(  )\n  h   = 1;\n  /* prettier-ignore */ i   =   [\n1];\n}\nconst j = [\n  // prettier-ignore\n  [1,0,\n   0,1],\n];\nfoo(\n  // prettier-ignore\n  a   +\n    b,\n);\n",
  "k-ignore-jsx.jsx":
    'const a = <div>\n  {/* prettier-ignore */}\n  <span   a  =  "1"\n     b>\n    x\n  </span>\n  {/* prettier-ignore */}\n  {foo   (\n  1)}\n</div>;\n',
  "k-flow-comment.js":
    "// @flow\nfunction f(a /*: string */, b /*: {\n  c: number\n} */) /*: void */ {}\n/*::\ntype A = {\n  a: 1\n};\n*/\n",
  "k-flow.js":
    "// @flow\ntype A = {|\n  a: 1 |};\ndeclare export function f(\n a: string): void;\nopaque type B = string;\nexport type C = {\n  ...D,\n\n  e: 1,\n};\n",
  "k-styled.js":
    "const A = styled.div`\n  /* c\n     d */\n  color: ${p => p.c};\n  // e\n  ${a}\n\n\n  &:hover { b: c }\n`;\nconst B = styled(C).attrs({})`\n  a: b;\n`;\nconst D = createGlobalStyle`\n  a{b:c}\n`;\nconst E = keyframes`\n  from{a:b}\n  to{a:c}\n`;\n",
  "k-styled-jsx.jsx":
    "const a = <div>\n  <style jsx>{`\n    a{b:c}\n\n    d{e:f}\n  `}</style>\n  <div css={`\n    a: b;\n  `} />\n</div>;\n",
  "k-gql.js":
    "const q = gql`\n  # c\n  query A {\n    a # d\n\n\n    b\n  }\n\n  ${B}\n\n  ${C}\n  # e\n`;\nconst r = /* GraphQL */ `\n  { a }\n`;\n",
  "k-md.js": "const m = markdown`\n  # a\n\n  \\`\\`\\`js\n  a  =  1\n  \\`\\`\\`\n\n  b  \n  c\n`;\n",
  "k-each2.js": "it.each`\n  a | b\n  ${1} | ${`x\ny`}\n  ${{\n a: 1}} | ${2}\n`('t', () => {});\n",
  "k-each3.js": "it.each`\n  a | b\n  ${function(){a;b}} | ${2}\n  ${[\n 1, // c\n 2]} | ${3}\n`('t', () => {});\n",
  "k-md-each.md": '- a\n\n  ```js\n  it.each`\n    a | b\n    ${1} | ${`x\n  y`}\n  `("t", () => {});\n  ```\n',
  "k-chain-comment.js": "a\n  // c\n  .b()\n  /* d\n     e */\n  .f()\n  .g();\nconst x = a /* h\n i */ ? b : c;\n",
  "k-arrow-body-template.js":
    "const f = () => `\n  a\n`;\nconst g = async () => `a\n${b}`;\nfoo(() => `\n  a\n`, b);\nexport default `\n a\n`;\n",
  "k-assign-template.js":
    "const aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa = `a\nb`;\nx.y = `\n`;\nconst { a = `b\nc` } = d;\n",
  "k-template-indent.js":
    "function f() {\n  return `\n    a ${b({\n      c: 1,\n    })} d\n    ${e}\n  `;\n}\nconst t = `\n\t${a}\n  \t${b}\n`;\n",
  "k-template-long-expr.js":
    "const a = `x ${aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccc(ddddddddd, eeeeeeeee)} y\n ${f(\n g)}`;\n",
  "k-jsx-text.jsx":
    "const a = <p>\n  a b\n  c&nbsp;d\n\n  e {\" \"}\n  f{' '}\n  <b>g</b>{' '}\n  h\n</p>;\nconst b = <p>a\n</p>;\nconst c = <p>\n</p>;\nconst d = <>\n\n</>;\n",
  "k-jsx-cond.jsx":
    "const a = <div>\n  {a &&\n    <b />}\n  {c ? <d /> :\n    <e />}\n  {f.map(g =>\n    <h key={g} />\n  )}\n</div>;\n",
  "k-string-escapes.js": "const a = 'a\\r\\nb';\nconst b = \"a\\\r\";\n",
  "k-class-blank.ts":
    "class A {\n\n  a = 1\n\n\n  // c\n\n  b = 2\n\n}\ninterface B {\n\n  a: 1\n\n\n  b: 2\n\n}\ntype C = {\n\n  a: 1\n\n  b: 2\n}\nenum D {\n\n  A,\n\n\n  B\n\n}\n",
  "k-params-blank.ts":
    "function f(\n  a,\n\n  b,\n) {}\nconst x = [\n\n  1,\n\n\n  2,\n\n];\nimport {\n  a,\n\n  b,\n} from 'c';\nfoo(a,\n\n  b);\ntype T = [\n  a,\n\n  b,\n];\n",
  "k-first-arg-blank.js": "foo(\n\n  a,\n  b\n\n);\nnew Foo(\n\n  a\n);\nfoo(function () {\n\n  a;\n\n}, b);\n",
  "k-else-comments.js":
    "if (a) {\n  b;\n}\n// c\nelse if (d) {\n  e;\n}\n/* f\n g */\nelse {\n  h;\n}\ntry {\n} // i\ncatch {\n}\n// j\nfinally {\n}\n",
  "k-trailing-ws.js": "a;   \nb; // c   \n/* d   \n   e   */\n`f   \n`;\n   \n\t\ng;\n",
  "k-label-empty.js": "a: ;\nb:\n  for (;;) {}\n;\n;\n",
  "k-object-prop-comment.js": "const a = {\n  b: // c\n    1,\n  d: /* e\n f */ 2,\n  g:\n    // h\n    3,\n};\n",
  "k-union-comment.ts": "type A =\n  // a\n  | B\n  // c\n  | D /* e\n f */\n  | G; // h\n",
  "k-vue-ts.vue":
    '<script setup lang="ts" generic="T extends\n string">\nconst a = `b\nc`\n// prettier-ignore\nconst d   =  [\n 1]\n</script>\n<template>\n  <a :b="`c\n d`" @e="() => {\n f()\n\n g()\n }" />\n</template>\n',
  "k-angular.component.html":
    '@if (a;\n as b) {\n  <p>{{ c\n | d }}</p>\n} @else {\n\n  <q [e]="f\n + g" (h)="i();\n j()" *ngFor="let k of l;\n trackBy: m"></q>\n}\n@for (a of b; track\n a) {\n x\n}\n',
  "k-md-nested.md":
    "- a\n\n  ```js\n  const a  =  `b\n  c`\n  ```\n\n  > d\n  > e\n\n  | f | g |\n  |---|---|\n  | h | i |\n\n1. j\n   k\n\n   <div>\n   l\n   </div>\n",
  "k-md-html-comment.md": "a <!-- b\nc --> d\n\n<!--\ne\n-->\n\n<details>\n<summary>f</summary>\n\ng\n\n</details>\n",
  "k-md-code-indent.md": "    a\n\n    b\n\t c\n\ntext\n\n\tcode\n",
  "k-md-escape.md": "a\\\n\n\\\n\n*a*\\\n*b*\n",
  "k-md-setext.md": "a\nb\n===\n\nc\n---\n",
  "k-md-footnote.md": "[^a]: b\n\n    c\n\n    ```\n    d\n    ```\n\ne[^a]\n",
  "k-md-yaml-front-comment.md": "---\n# c\na: |\n  b\n   c\n---\n\nd\n",
  "k-md-vue.md":
    '```vue\n<template><a   b /></template>\n<script>\na  =  1\n</script>\n```\n\n```html\n<a   b></a>\n```\n\n```graphql\nquery   { a }\n```\n\n```scss\n// c\na{b{c:d}}\n```\n\n```jsonc\n// c\n{"a":1}\n```\n\n```tsx\nconst a  = <b>\n c</b>\n```\n\n```hbs\n<a   b></a>\n```\n\n```md\n*  a\n```\n',
  "k-yaml-multi-doc-comment.yaml": "# a\n---\n# b\nc: 1\n# d\n...\n# e\n---\nf: 2\n",
  "k-yaml-seq-map.yaml": "- a: 1\n\n  b: 2\n\n\n- c:\n    - d\n\n    - e\n-\n  f: 1\n- ? g\n  : h\n",
  "k-yaml-quoted-fold.yaml": "a: \"b\n\n\n  c   \n  d\"\ne: 'f\n\n  g'\nh: i\n\n\n  j\n",
  "k-yaml-block-indicators.yaml": "a: |1-\n  b\nc: >2+\n   d\n\n\ne: | # f\n  g\nh: >-\n\n  i\n\n  j\n\n",
  "k-yaml-block-in-seq.yaml": "- |\n  a\n  b\n- >\n  c\n\n  d\n- - |\n    e\n",
  "k-yaml-flow-comment.yaml": "a: [\n  b, # c\n  d\n]\ne: {\n  f: g, # h\n\n  i: j\n}\n",
  "k-scss-map-comment.scss":
    "$a: (\n  // b\n  c: d,\n  /* e\n     f */\n  g: h,\n\n  i: j\n);\n@include k((\n  l: m,\n  n: o\n));\n",
  "k-scss-control.scss":
    "@if $a {\n  b: c;\n}\n@else if $d {\n  e: f;\n}\n\n@else {\n  g: h;\n}\n@while $i > 0 {\n  .j { k: l }\n}\n",
  "k-scss-interp.scss": ".a-#{$b\n}-c { d: #{$e\n + 1}; }\n@media #{$f}\n and (g: h) { i { j: k } }\n",
  "k-scss-doc.scss": "/// a\n/// b\n@mixin c { d: e }\n//f\n//  g   \n",
  "k-css-at.css":
    "@font-face{font-family:a;src:url(a.woff)\n format(\"woff\"),\n url(b.woff)}\n@page :first{margin:1in}\n@namespace a\n url(b);\n@layer a,\n b;\n@container c\n (min-width:1px){d{e:f}}\n@property --g{syntax:'<length>';\ninherits:false}\n",
  "k-css-important.css": "a{b:c\n!important;d:e !\nimportant;f:g\n/* h */;i:/* j\n k */l}\n",
  "k-css-attr.css": "a[b=\"c\\\nd\"],\ne[f='g'\n i]{h:i}\na:not(\n b,\n c){d:e}\n",
  "k-css-url.css": "a{b:url(data:image/png;base64,AAAA\nBBBB);c:url( 'd\\\ne' )}\n@import 'f\\\ng';\n",
  "k-css-empty-rule.css": "a{\n}\nb{\n\n}\nc{/* d */\n}\n\n\n\ne{}\n",
  "k-css-comment-decl.css": "a{\n  /* b */\n\n  /* c */\n  d:e;/* f */\n\n\n  /* g\n  */\n}\n",
  "k-less-mixins.less":
    '.a(@b: 1;\n @c: 2) when (@b > 0) {\n  d: e;\n}\n.f {\n  .a(1;\n  2) !important;\n  @g: {\n    h: i;\n  }\n  @g();\n  j: ~`k\n l`;\n  m: e("n\\\no");\n}\n@import (css,\n less) url("p");\n',
  "k-less-detached.less":
    "@a: {\n  b: c;\n\n  d: e;\n};\n.f when (default()) {\n  @a();\n}\n@media @g\n and @h { i { j: k } }\n",
  "k-gql-desc.graphql":
    '"a\\nb"\ntype A {\n  """\n  b\n\n\n  c   \n  """\n  d(\n    "e"\n    f: Int\n\n    """g"""\n    h: Int\n  ): Int\n}\n',
  "gql-k-comments.graphql":
    "query A(\n  # a\n  $b: Int # c\n  # d\n) {\n  # e\n  f # g\n\n  # h\n\n  i\n  # j\n}\n# k\n",
  "k-gql-directives.graphql":
    "type A @b(c: 1)\n  @d {\n  e: Int @f\n    @g(h: [1,\n 2], i: {j: 1,\n k: 2})\n}\nschema {\n  query: A\n\n  mutation: B\n}\n",
  "k-hbs-attr.hbs":
    '<div\n  class="a {{if b \'c\n d\'}}\n   e"\n  {{on "click" (fn f\n g)}}\n  ...attributes\n>\n</div>\n<input\n  disabled>\n',
  "k-hbs-block.hbs":
    "{{#each a as |b\n c|}}\n\n  {{b}}\n\n\n  {{c}}\n\n{{else}}\n  d\n{{/each}}\n{{#let (hash\n a=1\n b=2) as |x|}}\n  {{x.a}}\n{{/let}}\n",
  "k-hbs-text.hbs": "a\nb\n\nc   d\n\n\n\n<b>e</b>\nf\n<i>g</i> h\n",
  "k-hbs-comment.hbs": "{{!-- a\n     b\n--}}\n<!-- c\n  d -->\n{{! e }}\n<div {{! f\n g }}></div>\n",
  "k-html-nested-pre.html":
    '<ul>\n  <li>\n    <pre>\n      a\n    b\n</pre>\n  </li>\n  <li><pre>c\nd\n</pre>e</li>\n</ul>\n<pre\n  class="x"\n>\n\nf</pre>\n',
  "k-html-textarea.html":
    "<form>\n<textarea\n name=a>\n\n b\n  c\n</textarea>\n<select>\n<option>a\n<option>b\n</select>\n</form>\n",
  "k-html-cond-comment.html":
    "<!--[if lt IE 9]>\n<script src=a></script>\n\n<![endif]-->\n<!--[if !IE]><!-->\n<p>a</p>\n<!--<![endif]-->\n",
  "k-html-ignore-range.html":
    "<div>\n<!-- prettier-ignore-start -->\n<a   b>\n  c</a>\n<d   e></d>\n<!-- prettier-ignore-end -->\n<f   g></f>\n</div>\n",
  "k-html-display.html":
    "<!-- display: block -->\n<span>a</span>\n<span>b</span>\n<!-- display: inline -->\n<div>c</div>\n<div>d</div>\n",
  "k-html-svg.html":
    '<svg\n viewBox="0 0\n 1 1"><path d="M0 0\n L1 1"/><text>a\n b</text><style>\na{b:c}\n</style></svg>\n<math><mi>x</mi>\n</math>\n',
  "k-html-json-ld.html":
    '<script type="application/ld+json">\n  {"a":\n  1}\n</script>\n<script type="text/x-handlebars-template">\n  <a   b>{{c}}</a>\n</script>\n<script type="text/babel">\n const a = <b>\n c</b>\n</script>\n<script lang="ts">\n let a:number  =  1\n</script>\n<script type="speculationrules">\n{"a":1}\n</script>\n',
  "k-html-long-text.html":
    "<p>aaaaaaaaaaaa bbbbbbbbbbbbbbb cccccccccccccc dddddddddddddd eeeeeeeeeeeeeee\nfffffffffffffff ggggggggggggg <b>hhhhhhhhhhhh\niiiiiiiii</b>jjjjjjjjj\n</p>\n",
  "k-html-attr-ws.html":
    '<a\n\n  b\n\n  c = "d"\n  e\n  =\n  \'f\'\n>g</a>\n<img alt="\n" src="\n a \n">\n<p class="\n\n"></p>\n<p style="\n"></p>\n',
  "k-vue-pug.vue":
    '<template lang="pug">\ndiv\n  p a\n\n  p b\n</template>\n\n<script lang="coffee">\na = ->\n  b\n</script>\n\n<style lang="sass">\na\n  b: c\n</style>\n',
  "k-vue-blank.vue": "\n\n<template>\n  <a />\n</template>\n\n\n\n<script>\n\n\nexport default {}\n\n\n</script>\n\n\n",
  "k-vue-comment-root.vue": "<!-- a\n  b -->\n<template>\n  <!-- c\n    d -->\n  <a />\n</template>\n<!-- e -->\n",
  "k-vue-interp.vue":
    '<template>\n  <p>{{\n    a\n  }} b {{ c ?\n d : e }}\n  {{ `f\n g` }}</p>\n  <q v-html="`h\n i`" :j="{\n   k: 1 }" v-for="(l,\n m) of n" v-slot:o="{ p,\n q }" />\n</template>\n',
  "k-mjml.mjml":
    "<mjml>\n<mj-head>\n<mj-style>\na{b:c}\n</mj-style>\n</mj-head>\n<mj-body>\n<mj-text>a\n b</mj-text>\n<mj-raw>\n <p>c</p>\n</mj-raw>\n</mj-body>\n</mjml>\n",
  "k-jsonc.jsonc":
    '{\n  // a\n  "b": 1, // c\n\n\n  /* d\n     e */\n  "f": [\n    // g\n  ],\n  "h": {\n    /* i */\n  }\n}\n// j\n',
  "k-json-blank.json": '{\n\n  "a": 1,\n\n\n  "b": [\n\n    1,\n\n    2\n\n  ]\n\n}\n',
  "k-json-top.json": "\n\n[1,\n2]\n\n\n",
  "k-json-ignore2.jsonc":
    '[\n  // prettier-ignore\n  {"a":1,\n   "b":2},\n  /* prettier-ignore */ [1,\n2],\n  {"c":1,\n   "d":2}\n]\n',
  ".babelrc": '{"a":1,// c\n"b":2}\n',
  "tsconfig.json": '{// c\n"a":1,\n}\n',
  ".swcrc": '{"a":[1,\n2]}\n',
};
