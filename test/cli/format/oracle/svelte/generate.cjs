// bun generate.cjs <directory> <count> [<seed>]: writes small components, out of the pieces whose white space prettier-plugin-svelte cares about.
const fs = require("node:fs");
const [out, count, seed] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4] ?? 1)];
let s = seed >>> 0;
const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
const ws = () => pick(["", "", " ", " ", "\n", "\n", "\n\n", "  ", "\n  ", "\n\n\n", "\t", " \n "]);
const word = () =>
  pick(["a", "bb", "text", "longer-word", "x.", "&amp;", "é", " ", "1", "some", "words", "here", "and", "there"]);
const text = () =>
  Array.from({ length: 1 + Math.floor(rnd() * (rnd() < 0.15 ? 30 : 4)) }, word).join(
    pick([" ", " ", "  ", "\n", " \n"]),
  );
const expr = () =>
  pick([
    "a",
    "a.b",
    "a + b",
    "f(a, b)",
    "a ? b : c",
    "{ a, b }",
    "[1, 2]",
    "() => a",
    "a && b",
    "'s'",
    '"d"',
    "`t${a}`",
    "a || b || c",
    "(a, b)",
    "await p",
    "x => { y(); }",
    "a /* c */",
    "/* c */ a",
    "veryLongFunctionName(argumentNumberOne, argumentNumberTwo, argumentNumberThree, four)",
    "aaaaaaaaaaaaaaaaaaaaaaaa && bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb && cccccccccccccccccccccccccc && d",
    "a as any",
    "a!",
  ]);
const jsexpr = () => {
  if (globalThis.__ts && rnd() < 0.2) return tsexpr();
  let e;
  do e = expr();
  while (/ as |!$/.test(e));
  return e;
};
const attr = () =>
  pick([
    () => "a",
    () => `b="c"`,
    () => `class="x  y ${pick(["", " ", "\n z"])}"`,
    () => `d={${jsexpr()}}`,
    () => `{e}`,
    () => `e={e}`,
    () => `f="g{${jsexpr()}}h"`,
    () => `{...${jsexpr()}}`,
    () => `on:click={${jsexpr()}}`,
    () => `on:click|once|capture`,
    () => `bind:value`,
    () => `bind:value={value}`,
    () => `bind:value={v.w}`,
    () => `bind:x={() => a, (v) => (a = v)}`,
    () => `class:a`,
    () => `class:a={a}`,
    () => `class:a={b}`,
    () => `style:color`,
    () => `style:color="red"`,
    () => `style:color={c}`,
    () => `style:color|important="a{b}"`,
    () => `use:act`,
    () => `use:act={${jsexpr()}}`,
    () => `transition:fade|local`,
    () => `in:fly={{ y: 1 }}`,
    () => `out:fade`,
    () => `animate:flip`,
    () => `let:item`,
    () => `let:item={i}`,
    () => `h='i'`,
    () => `j=k`,
    () => `title="a 'b' c"`,
    () => `l="{m}"`,
    () => `{@attach ${jsexpr()}}`,
    () => `data-long-attribute-name="a rather long value of an attribute"`,
    () => `n=""`,
  ])();
const attrs = () =>
  Array.from({ length: Math.floor(rnd() * (rnd() < 0.2 ? 7 : 3)) }, attr)
    .map(a => pick([" ", " ", "\n  ", "  "]) + a)
    .join("");
const dedupe = a => {
  const seen = new Set();
  return a
    .split(/(?=\s+\S)/)
    .filter(x => {
      const n =
        x
          .trim()
          .replace(/^(bind:|class:|style:)?/, "$1")
          .split(/[=|{]/)[0] || x;
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    })
    .join("");
};
const name = () =>
  pick([
    "span",
    "span",
    "b",
    "a",
    "div",
    "div",
    "p",
    "ul",
    "li",
    "Comp",
    "Comp.Sub",
    "button",
    "h1",
    "section",
    "svelte:fragment",
    "svelte:self",
    "slot",
    "custom-el",
    "table",
    "label",
  ]);
const node = d => {
  const r = rnd();
  if (d > 3 || r < 0.3) return text();
  if (r < 0.55) {
    const n = name();
    const a = safeAttrs();
    return rnd() < 0.15
      ? `<${n}${a}${pick(["", " "])}/>`
      : `<${n}${a}${pick(["", "", "\n"])}>${children(d + 1)}</${n}>`;
  }
  if (r < 0.62) return `{${jsexpr()}}`;
  if (r < 0.66) return pick(["<br>", "<br/>", "<img src='a'>", `<input${safeAttrs()}>`, "<hr />"]);
  if (r < 0.665)
    return pick([
      () => `<script>let  x = 1</script>`,
      () => `<style>a{b:c}</style>`,
      () => `<template lang="pug">\n  p a\n</template>`,
      () => `<div\n  // a comment\n  a="b"\n  /* another */ c\n>${children(d + 1)}</div>`,
      () => `<p class="a   b\n    c  {d}   e ">${text()}</p>`,
      () =>
        `<svelte:head><title>${pick(["a", " a {b} ", ""])}</title>${children(d + 1)}</svelte:head>`
          .replace(/^/, d === 0 && !globalThis.__head++ ? "" : "<!-- -->")
          .replace(/^<!-- --><svelte:head>.*$/s, "<i>x</i>"),
      () => `<!-- prettier-ignore -->\n<div   a  =  "b"  >  x  </div>`,
      () => `<p style:color="a  b {c}  d">x</p>`,
      () => `<a href="x"\n>y</a\n>`,
      () => `<span>${text()}</span><span>${text()}</span>`,
      () => `<b>${"long ".repeat(25)}</b>`,
      () => `<input value="{a}{b}" disabled={true} data-x='{"a":1}'>`,
      () => `<Comp let:a let:b={c} on:x on:y={z} {...$$props} {...$$restProps} />`,
      () => `{#if a}{@const b = ${jsexpr()}}${children(d + 1)}{/if}`,
      () => `{#each x as y}{@const { a, b } = y}{a}{/each}`,
      () => `{#if a}{const c = ${jsexpr()}}{c}{/if}`,
      () => `{#if a}{let c = $state(1)}{c}{/if}`,
      () => `&lt;&nbsp;&#123;`,
      () => `<svelte:self a={1} />`,
      () => `<svelte:fragment slot="a">${children(d + 1)}</svelte:fragment>`,
      () => `<slot name="a" b={c}>${children(d + 1)}</slot>`,
    ])();
  if (r < 0.72)
    return `{#if ${jsexpr()}}${children(d + 1)}${rnd() < 0.4 ? `{:else if ${jsexpr()}}${children(d + 1)}` : ""}${rnd() < 0.4 ? `{:else}${children(d + 1)}` : ""}{/if}`;
  if (r < 0.78)
    return `{#each ${pick(["items", "a.b", "f()", "[1, 2]"])}${pick([" as item", " as item, i", " as item (item.id)", " as { a, b }", " as [a, b], i (a)", " as { a: { b }, ...c }", " as { a = 1 }", "", ", i"])}}${children(d + 1)}${rnd() < 0.3 ? `{:else}${children(d + 1)}` : ""}{/each}`;
  if (r < 0.82)
    return pick([
      () => `{#await p}${children(d + 1)}{:then v}${children(d + 1)}{:catch e}${children(d + 1)}{/await}`,
      () => `{#await p then v}${children(d + 1)}{/await}`,
      () => `{#await p catch e}${children(d + 1)}{/await}`,
      () => `{#await p}${children(d + 1)}{/await}`,
      () => `{#await p then { a, b }}${children(d + 1)}{:catch}${children(d + 1)}{/await}`,
      () => `{#await p}{:then}${children(d + 1)}{/await}`,
    ])();
  if (r < 0.85) return `{#key ${jsexpr()}}${children(d + 1)}{/key}`;
  if (r < 0.88)
    return `{#snippet ${pick(["s()", "s(a)", "s(a, b = 1)", "s({ a, b })", "s( a )"])}}${children(d + 1)}{/snippet}`;
  if (r < 0.91)
    return pick(["{@html a}", "{@render s()}", "{@render s?.(a)}", "{@debug a, b}", "{@debug}", "{@html  `<b>`  }"]);
  if (r < 0.94) return pick(["<!-- c -->", "<!--c-->", "<!-- a\n  b -->", "<!-- prettier-ignore -->", "<!---->"]);
  if (r < 0.96) return `<pre${safeAttrs()}>${pick(["", "\n"])}  a\n   b {c} <b> d </b>\n</pre>`;
  if (r < 0.97) return `<textarea>${pick(["", " a\n  b {c}", "\n"])}</textarea>`;
  if (r < 0.98)
    return `<svelte:element this={${pick(["tag", '"div"', "a ? 'b' : 'c'"])}}${safeAttrs()}>${children(d + 1)}</svelte:element>`;
  if (r < 0.99) return `<svelte:component this={C}${safeAttrs()} />`;
  return `<svelte:boundary>${children(d + 1)}</svelte:boundary>`;
};
const safeAttrs = () => dedupe(attrs());
const children = d => {
  let o = ws();
  const n = Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) o += node(d) + ws();
  return o;
};
const TS = () => globalThis.__ts;
const tsexpr = () =>
  pick(["a as any", "a!", "a satisfies B", "<T,>(x: T) => x", "(a as B).c", "f<string>(a)", "a as unknown as B[]"]);
const script = () =>
  pick([
    `<script>\n  let a = 1\n</script>`,
    `<script lang="ts">\nlet a: number = 1;\n\n\nexport let b\n</script>`,
    `<script module>export const x=1</script>`,
    `<script context="module">\n</script>`,
    `<script></script>`,
    `<script>\n\n</script>`,
    `<script>let a = ;</script>`,
  ]);
const style = () =>
  pick([
    `<style>\n a{color:red}\n</style>`,
    `<style lang="scss">a{b{c:d}}</style>`,
    `<style></style>`,
    `<style>\n</style>`,
    `<style lang="less">@a:1;</style>`,
    `<style>a{</style>`,
  ]);
for (let i = 0; i < count; i++) {
  globalThis.__ts = rnd() < 0.4;
  globalThis.__head = 0;
  const parts = [];
  if (globalThis.__ts) parts.push(`<script lang="ts">\n  let a: number = 1\n  type B = { c: string }\n</script>`);
  if (rnd() < 0.08)
    parts.push(
      pick([
        "<!-- prettier-ignore-start -->\n<div   >  a </div>\n<p   >b</p>\n<!-- prettier-ignore-end -->",
        "<svelte:window on:keydown={f} />",
        "<svelte:body on:click={f} />",
        "<svelte:document on:x={f} />",
        "<!-- #region a -->\n<script module>let m</script>\n<!-- #endregion -->",
        "<!-- svelte-ignore a11y -->",
      ]),
    );
  if (!globalThis.__ts && rnd() < 0.5)
    parts.push(
      (rnd() < 0.2 ? pick(["<!-- about the script -->\n", "<!-- a --><!-- b -->", "<!-- a -->\n\n"]) : "") + script(),
    );
  if (rnd() < 0.1)
    parts.push(
      `<svelte:options ${pick(["runes", "runes={true}", 'namespace="svg"', "immutable={false} accessors"])} />`,
    );
  parts.push(children(0) || "x");
  if (rnd() < 0.3) parts.push(style());
  if (rnd() < 0.2) parts.push(children(0));
  if (rnd() < 0.3) parts.sort(() => rnd() - 0.5);
  fs.writeFileSync(`${out}/${i}.svelte`, parts.join(ws()));
}
