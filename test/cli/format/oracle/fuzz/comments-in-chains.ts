// A comment of six forms in every gap of member chains, member accesses and calls: 16 things that a chain starts with, 17 chains, 6 surroundings.
//   bun comments-in-chains.ts --bin=<bun-lint> --prettier=<directory with node_modules/prettier> --dir=<directory for temporary files> --out=<file>
//     [--set=gaps]    the chain as it is (the default)
//     [--set=parens]  with parentheses around every prefix of the chain, and the comment next to one of them. `parens-all`: in every gap
//     [--pairs=1]     two comments at once
//     [--long=1]      names that do not fit on one line
//     [--ctx=stmt,assign,arg,arrow,await,member] [--heads=a,b] [--tails=a,b] [--options=<json>]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const flags = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const m = /^--([\w-]+)=(.*)$/s.exec(arg);
  if (m) flags.set(m[1], m[2]);
}
const bin = flags.get("bin")!;
const options = JSON.parse(flags.get("options") ?? "{}");
const dir = flags.get("dir")!;
mkdirSync(dir, { recursive: true });
const prettier = await import(resolve(flags.get("prettier")!, "node_modules/prettier/index.mjs"));
const heads = [
  "f",
  "this",
  "Foo",
  "longname",
  "f ( )",
  "a . b",
  "f [ 0 ]",
  "f [ k ]",
  "f !",
  "new f ( )",
  "( a || b )",
  "`t`",
  "[ ]",
  "a ?. b",
  "import ( a )",
  "super_",
];
const tails = [
  ". x ( 1 )",
  ". x ( 1 ) . y ( 2 )",
  ". x ( 1 ) . y ( 2 ) . z ( 3 )",
  ". x . y ( 2 ) . z ( 3 )",
  ". x ( 1 ) ( 2 ) . z ( 3 )",
  "[ k ] ( 1 ) . y ( 2 ) . z ( 3 )",
  ". x ( 1 ) [ k ] ( 2 ) . z ( 3 )",
  ". x ( 1 ) [ 0 ] . y ( 2 ) . z ( 3 )",
  ". x ( 1 ) [ 's' ] ( 2 ) . z ( 3 )",
  "?. x ( 1 ) ?. y ( 2 ) . z ( 3 )",
  ". x ?. ( 1 ) . y ?. ( 2 ) . z ( 3 )",
  ". x ( 1 ) ?. [ k ] ( 2 ) . z ( 3 )",
  ". x ! ( 1 ) . y ( 2 ) ! . z ( 3 )",
  ". x ( 1 ) . y ( 2 ) . z",
  ". x ( ( ) => { } ) . y ( ( ) => { } ) . z ( 3 )",
  ". #x ( 1 ) . y ( 2 ) . z ( 3 )",
  ". x < T > ( 1 ) . y ( 2 ) . z ( 3 )",
];
const contexts: [string, string, string][] = [
  ["stmt", "", " ;"],
  ["assign", "v = ", " ;"],
  ["arg", "g ( ", " ) ;"],
  ["arrow", "v = ( ) => ", " ;"],
  ["await", "async function w ( ) { await ", " ; }"],
  ["member", "v = ", " . length ;"],
];
const forms: [string, string][] = [
  ["blk", " /* c */ "],
  ["eol", " // c\n"],
  ["own", "\n// c\n"],
  ["ownblk", "\n/* c */\n"],
  ["doc", " /**\n * c\n */ "],
  ["blkeol", " /* c */\n"],
];
const wantCtx = flags.get("ctx")?.split(",");
if (flags.has("heads")) heads.splice(0, heads.length, ...flags.get("heads")!.split(","));
if (flags.has("tails")) tails.splice(0, tails.length, ...flags.get("tails")!.split(","));
if (flags.has("long")) {
  const L: Record<string, string> = {
    x: "xxxxxxxxxxxxxxxxxxxxxxxxx",
    y: "yyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    z: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  };
  for (let i = 0; i < tails.length; i++)
    tails[i] = tails[i]
      .split(" ")
      .map(t => L[t] ?? t)
      .join(" ");
}
const set = flags.get("set") ?? "gaps";
type Case = { code: string; ext: string; name: string };
const cases: Case[] = [];
// The ends of the prefixes of a chain that are expressions: token indexes after which a `)` can stand.
function prefixEnds(tokens: string[], headLength: number): number[] {
  const ends = [headLength];
  let depth = 0;
  for (let i = headLength; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "(" || t === "[" || t === "{") depth++;
    if (t === ")" || t === "]" || t === "}") {
      depth--;
      if (depth === 0) ends.push(i + 1);
      continue;
    }
    if (depth === 0 && ((/^#?[a-z]+$/.test(t) && /^\??\.$/.test(tokens[i - 1])) || t === "!")) ends.push(i + 1);
  }
  return ends;
}
for (const head of heads)
  for (const tail of tails) {
    const headTokens = head.split(" "),
      tokens = [...headTokens, ...tail.split(" ")];
    const ts = /!|< T >/.test(head + tail);
    const priv = tail.includes("#");
    const variants: [string, string[], number[]][] = [];
    if (set === "gaps") variants.push(["", tokens, tokens.map((_, i) => i).concat(tokens.length)]);
    else
      for (const end of prefixEnds(tokens, headTokens.length)) {
        if (end === tokens.length && set !== "parens-all") continue;
        const t = ["(", ...tokens.slice(0, end), ")", ...tokens.slice(end)];
        variants.push([
          `(..${end})`,
          t,
          set === "parens" ? [0, 1, end + 1, end + 2] : t.map((_, i) => i).concat(t.length),
        ]);
      }
    for (const [vname, t, gaps] of variants)
      for (const [cname, before, after] of contexts) {
        if (wantCtx && !wantCtx.includes(cname)) continue;
        if (flags.has("pairs")) {
          for (const i of gaps)
            for (const j of gaps)
              if (i <= j)
                for (const [f1, form1] of forms)
                  for (const [f2, form2] of forms) {
                    if (i === 0 || j === t.length) continue;
                    let code =
                      before +
                      t.slice(0, i).join(" ") +
                      form1.replace("c", "c1") +
                      t.slice(i, j).join(" ") +
                      form2.replace("c", "c2") +
                      t.slice(j).join(" ") +
                      after;
                    if (priv) code = `class C { #x ; m ( ) { ${code} } }`;
                    cases.push({
                      code,
                      ext: ts ? "ts" : "js",
                      name: `${cname} ${vname} ${t.join(" ")} @${i},${j} ${f1},${f2}`,
                    });
                  }
          continue;
        }
        for (const i of gaps)
          for (const [fname, form] of forms) {
            if (t[i - 1] === "<" || (t[i] === ">" && t[i - 1] === "T")) {
              /* fine in ts */
            }
            let code = before + t.slice(0, i).join(" ") + form + t.slice(i).join(" ") + after;
            if (priv) code = `class C { #x ; m ( ) { ${code} } }`;
            for (const ext of ts ? ["ts"] : ["js"])
              cases.push({ code, ext, name: `${cname} ${vname} ${t.join(" ")} @${i} ${fname}` });
          }
      }
  }
console.error(cases.length + " cases");
const server = Bun.spawn({
  cmd: [bin, "format", "serve", ...Object.entries(options).map(([n, v]) => `--${n}=${v}`)],
  stdin: "pipe",
  stdout: "pipe",
  stderr: "ignore",
});
const reader = server.stdout.getReader();
let buffered = new Uint8Array(0);
async function fill() {
  const { value, done } = await reader.read();
  if (done) throw new Error("exited");
  const j = new Uint8Array(buffered.length + value.length);
  j.set(buffered);
  j.set(value, buffered.length);
  buffered = j;
}
async function readLine() {
  let e: number;
  while ((e = buffered.indexOf(10)) < 0) await fill();
  const l = new TextDecoder().decode(buffered.subarray(0, e));
  buffered = buffered.subarray(e + 1);
  return l;
}
async function readBytes(n: number) {
  while (buffered.length < n) await fill();
  const b = buffered.subarray(0, n);
  buffered = buffered.subarray(n);
  return new TextDecoder().decode(b);
}
let same = 0,
  diff = 0,
  rejected = 0,
  errors = 0;
const out: string[] = [];
const names: string[] = [];
for (const c of cases) {
  let expected: string;
  try {
    expected = await prettier.format(c.code, { ...options, filepath: "x." + c.ext });
  } catch {
    rejected++;
    continue;
  }
  const path = join(dir, "c." + c.ext);
  writeFileSync(path, c.code);
  server.stdin.write(path + "\n");
  server.stdin.flush();
  const line = await readLine();
  if (!line.startsWith("ok ")) {
    errors++;
    out.push(`### ERR [${c.ext}] ${c.name} ${line}\n--- input\n${c.code}`);
    continue;
  }
  const actual = await readBytes(Number(line.slice(3)));
  if (actual === expected) same++;
  else {
    diff++;
    names.push(c.name);
    out.push(`### [${c.ext}] ${c.name}\n--- input\n${c.code}\n--- expected\n${expected}--- actual\n${actual}`);
  }
}
server.stdin.end();
console.log(`${same} same, ${diff} differ, ${errors} errors, ${rejected} rejected`);
writeFileSync(flags.get("out")!, out.join("\n"));
