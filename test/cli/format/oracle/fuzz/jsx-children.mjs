// Prints random JSX children, to be formatted at several widths by Prettier and by us.
//   bun jsx-children.mjs <seed> > x.jsx
let seed = Number(process.argv[2] ?? 1); const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const words = ["a", "b", ",", ".", "…", "—", "😀", "foo", "bar", "lorem", "ipsum", "dolor", "consectetur", "adipiscing", "&nbsp;", "&middot;", "(", ")", "x,", "longerwordhere", "evenlongerwordthatgoeson", "é", "日本語"];
const ws = [" ", " ", " ", "  ", "\n", "\n", "\n  ", " \n", "\n\n", "\n \n  ", "", "", ""];
function child(depth) {
  const r = rnd();
  if (r < 0.45) return pick(words);
  if (r < 0.55) return '{" "}';
  if (r < 0.65) return pick(["{x}", "{foo.bar}", "{cond ? 'yes' : 'no'}", "{a && b}", "{fn(arg1, arg2)}", "{`t`}", "{items.map(i => <li key={i}>{i}</li>)}", "{...rest}", "{'str'}", "{' '}", "{\"  \"}", "{a /* c */}"]);
  if (r < 0.75) return pick(["<br />", "<Icon name=\"x\" />", "<b />", "<Foo a={1} b={2} />"]);
  if (r < 0.80) return pick(["{/* comment */}", "{}", "{/* prettier-ignore */}", "{// line\n}"]);
  if (r < 0.95 && depth < 3) return element(depth + 1);
  return pick(["<></>", "<i></i>", "<b>x</b>", "<a href=\"y\">link</a>"]);
}
function element(depth) {
  const tag = pick(["div", "span", "Text", "p", "", "fbt", "Box"]);
  const attrs = tag === "" ? "" : pick(["", "", "", " bold", " a=\"1\"", " a={1} b", " className=\"foo bar\" id={x}"]);
  const n = Math.floor(rnd() * 8);
  let s = "";
  for (let i = 0; i < n; i++) s += pick(ws) + child(depth);
  s += pick(ws);
  return `<${tag}${attrs}>${s}</${tag}>`;
}
const out = [];
for (let i = 0; i < 400; i++) out.push(`x${i} = ${element(0)};`);
console.log(out.join("\n"));
