// Random HTML, Vue, Angular templates, LWC and MJML: inputs of Prettier's snapshots with a few random changes, a soup of markers, or trees
// from a grammar of inline and block elements with text of any width. Compares the formatted text, and whether the input is refused.
//
//   bun html.ts <bun-lint> <directory with node_modules/prettier> <prettier/tests/format> <directory for a temporary directory>
//     [-parser=html|vue|angular|lwc|mjml] [-make=mutate|soup|tree] [-n=500] [-seed=1] [-show=5] [--printWidth=40 ..]
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const [bin, prettierRoot, fixtures, scratch, ...args] = process.argv.slice(2);
const prettier = await import(join(resolve(prettierRoot), "node_modules/prettier/index.mjs"));
const flag = (name: string, otherwise: string) =>
  (args.find(it => it.startsWith(`-${name}=`)) ?? `-${name}=${otherwise}`).slice(name.length + 2);
const [parser, make, count, show] = [
  flag("parser", "html"),
  flag("make", "mutate"),
  +flag("n", "500"),
  +flag("show", "5"),
];
const options: Record<string, unknown> = {};
for (const it of args.filter(it => it.startsWith("--"))) {
  const [key, value] = it.slice(2).split("=");
  options[key] = value === "true" ? true : value === "false" ? false : /^\d+$/.test(value) ? +value : value;
}

let seed = +flag("seed", "1");
const random = (below: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 8) % below;
const pick = <T>(from: T[]) => from[random(from.length)];

const inputs: string[] = [];
(function walk(directory: string) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    if (!name.endsWith(".snap")) continue;
    const snapshots: Record<string, string> = {};
    new Function("exports", readFileSync(path, "utf8"))(snapshots);
    for (const snapshot of Object.values(snapshots)) {
      const input = /=+input=+\n([\s\S]*?)\n=+output=+\n/.exec(snapshot)?.[1];
      if (input !== undefined && input.length < 1200) inputs.push(input + "\n");
    }
  }
})(join(fixtures, parser));

// prettier-ignore
const bits = ["<", ">", "</", "/>", "<a>", "</a>", "<b>", "</b>", "<div>", "</div>", "<p>", "</p>", "<span>", "</span>", "<br>", "<br/>", "<img src=a>", "<pre>", "</pre>",
  "<textarea>", "</textarea>", "<ul>", "<li>", "</li>", "</ul>", "<table>", "<tr>", "<td>", "</td>", "<select>", "<option>", "<button>", "</button>", "<script>", "</script>",
  "<style>", "</style>", "<template>", "</template>", "<svg>", "</svg>", "<foreignObject>", "<math>", "<!--", "-->", "<!-- prettier-ignore -->", "<!-- display: block -->",
  "<!-- display: inline -->", "<!-- prettier-ignore-attribute -->", "<!--[if IE]>", "<![endif]-->", "<!DOCTYPE html>", "<![CDATA[", "]]>", "<?xml ?>", " ", "  ", "\n", "\n\n",
  "\n\n\n", "\t", "a", "b c", "lorem ipsum dolor sit amet", "consectetur", "中文", "é", "😀", "&amp;", "&nbsp;", "&#35;", "&", " ", "=", '"', "'", ' a="b"', " a='b'", " a=b",
  ' class="a  b c"', ' style="a:b;c:d"', ' onclick="a()"', " disabled", ' srcset="a 1x, b 2x"', ' a="\n b \n"', "{{", "}}", "{{ a }}", "{{a|b}}", "{", "}", "@if (a) {", "@else {",
  "@for (a of b; track a) {", "@let a = 1;", "@", ' v-if="a"', ' v-for="a in b"', ' :a="b"', ' @a="b"', ' #a="b"', ' [a]="b"', ' (a)="b()"', ' *a="b"', ' lang="ts"', "a{b:c}",
  "let a=1", "---\n", "{a, plural, =0 {b}}", "<mj-text>", "</mj-text>", "<mjml>"];
function mutate() {
  let text = pick(inputs);
  for (let changes = 1 + random(4); changes > 0; changes--) {
    const at = random(text.length + 1);
    const lines = text.split("\n");
    switch (random(6)) {
      case 0:
        text = text.slice(0, at) + pick(bits) + text.slice(at);
        break;
      case 1:
        text = text.slice(0, at) + text.slice(at + 1 + random(3));
        break;
      case 2: {
        const [a, b] = [random(lines.length), random(lines.length)];
        [lines[a], lines[b]] = [lines[b], lines[a]];
        text = lines.join("\n");
        break;
      }
      case 3: {
        const a = random(lines.length);
        lines.splice(a, 1);
        text = lines.join("\n");
        break;
      }
      case 4:
        text = text.slice(0, at) + pick(pick(inputs).split("\n")) + "\n" + text.slice(at);
        break;
      // White space comes or goes next to a tag.
      case 5: {
        const tags = [...text.matchAll(/[<>]/g)];
        if (tags.length) {
          const tag = pick(tags).index + random(2);
          text = /\s/.test(text[tag] ?? "")
            ? text.slice(0, tag) + text.slice(tag + 1)
            : text.slice(0, tag) + pick([" ", "\n", "\n\n"]) + text.slice(tag);
        }
        break;
      }
    }
  }
  return text;
}
const soup = () => Array.from({ length: 2 + random(14) }, () => pick(bits)).join("") + "\n";

const words = () =>
  Array.from({ length: 1 + random(9) }, () => "x".repeat(1 + random(11))).join(pick([" ", " ", " ", "\n", "  "]));
const space = () => pick(["", "", "", " ", "\n", "\n\n", "\n  "]);
// prettier-ignore
const names = ["a", "b", "span", "em", "code", "label", "button", "div", "p", "section", "ul", "li", "table", "tr", "td", "pre", "textarea", "select", "option", "video", "x-y", "details",
  "summary", "template", "h1", "svg", "g", "input", "br", "img", "hr"];
const attribute = () =>
  pick([
    ` a`,
    ` a="${words()}"`,
    ` class="${words()}"`,
    ` id=x`,
    ` data-x='${"y".repeat(random(40))}'`,
    ` style="color: red; a: ${"b".repeat(random(30))}"`,
    ` href="#"`,
  ]);
function tree(depth: number): string {
  switch (depth > 4 ? random(3) : random(9)) {
    case 0:
    case 1:
      return words();
    case 2:
      return pick([
        "<!-- c -->",
        `<!-- ${words()} -->`,
        "<br />",
        "<input>",
        "{{ a }}",
        `{{ ${"a".repeat(1 + random(30))} + b }}`,
      ]);
    default: {
      const name = pick(names);
      const start = `<${name}${Array.from({ length: random(4) }, attribute).join("")}${pick(["", "", " ", "\n"])}>`;
      if (["input", "br", "img", "hr"].includes(name)) return start;
      return (
        start + space() + Array.from({ length: random(5) }, () => tree(depth + 1) + space()).join("") + `</${name}>`
      );
    }
  }
}
const forest = () => Array.from({ length: 1 + random(4) }, () => tree(0) + space()).join("") + "\n";

const directory = mkdtempSync(join(resolve(scratch), "html-fuzz-"));
const file = join(
  directory,
  { html: "input.html", vue: "input.vue", angular: "input.component.html", lwc: "input.html", mjml: "input.mjml" }[
    parser
  ]!,
);
const flags = [`--parser=${parser}`, ...Object.entries(options).map(([key, value]) => `--${key}=${value}`)];
function serve() {
  const server = Bun.spawn({
    cmd: [bin, "format", "serve", ...flags],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  return { server, reader: server.stdout.getReader(), buffered: new Uint8Array(0) };
}
let served = serve();
/** The formatted text of `file`, or `undefined` if it is refused. Throws if the process has gone. */
async function format(): Promise<string | undefined> {
  served.server.stdin.write(file + "\n");
  served.server.stdin.flush();
  const fill = async () => {
    const { value, done } = await served.reader.read();
    if (done) throw new Error("the process has gone");
    const joined = new Uint8Array(served.buffered.length + value.length);
    joined.set(served.buffered);
    joined.set(value, served.buffered.length);
    served.buffered = joined;
  };
  let end: number;
  while ((end = served.buffered.indexOf(10)) < 0) await fill();
  const head = new TextDecoder().decode(served.buffered.subarray(0, end));
  served.buffered = served.buffered.subarray(end + 1);
  if (!head.startsWith("ok ")) return undefined;
  const length = +head.slice(3);
  while (served.buffered.length < length) await fill();
  const text = new TextDecoder().decode(served.buffered.subarray(0, length));
  served.buffered = served.buffered.subarray(length);
  return text;
}

let [same, total, shown] = [0, 0, 0];
try {
  for (let i = 0; i < count; i++) {
    const text = (make === "soup" ? soup() : make === "tree" ? forest() : mutate()).replaceAll("\r", "");
    let expected: string | undefined;
    try {
      expected = await prettier.format(text, { parser, filepath: file, ...options });
    } catch {}
    writeFileSync(file, text);
    let actual: string | undefined;
    try {
      actual = await Promise.race([
        format(),
        Bun.sleep(10_000).then(() => Promise.reject(new Error("it takes more than 10 s"))),
      ]);
    } catch (error) {
      actual = `${error}`;
      served.server.kill();
      served = serve();
    }
    total++;
    if (actual === expected) {
      same++;
    } else if (shown++ < show) {
      const [a, b] = [(expected ?? "(refused)").split("\n"), (actual ?? "(refused)").split("\n")];
      const line = a.findIndex((it, index) => it !== b[index]);
      console.log(
        `##### ${JSON.stringify(text)}\n  line ${line + 1}\n  - ${a.slice(line, line + 4).join("\n  - ")}\n  + ${b.slice(line, line + 4).join("\n  + ")}`,
      );
    }
  }
} finally {
  served.server.kill();
  rmSync(directory, { recursive: true });
}
console.log(`${same}/${total} the same`);
