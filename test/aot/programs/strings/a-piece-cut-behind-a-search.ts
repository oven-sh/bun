const hidden = new Function("v", "return v") as <V>(v: V) => V;

function extensionOf(path: string): string | undefined {
  const at = path.lastIndexOf(".d.");
  return at >= 0 ? path.substring(at) : undefined;
}
function pieceAndNumber(text: string, from: number, to: number): [string, number] {
  const piece = text.slice(from, to);
  return [piece, Number(piece)];
}
function pieceAndTest(text: string, from: number, to: number): [string, boolean] {
  const piece = text.slice(from, to);
  return [piece, piece === "ab"];
}
function twoSearches(path: string): number {
  return path.lastIndexOf(".d.") * 1000 + path.lastIndexOf("/");
}
function pieceOfPiece(text: string, from: number, to: number, inner: number): [string, boolean] {
  const outer = text.slice(from, to);
  return [outer, outer.slice(inner) === "ab"];
}

const wrong: string[] = [];
let digest = 0;
function note(name: string, got: unknown, expected: unknown): void {
  const a = JSON.stringify(got) ?? "undefined", b = JSON.stringify(expected) ?? "undefined";
  if (a !== b) wrong.push(`${name}: ${a} | ${b}`);
  for (let i = 0; i < a.length; i++) digest = (digest * 31 + a.charCodeAt(i)) | 0;
}

const folders = ["/src/compiler/", "/très/loin/là-bas/", "/日本語/のフォルダ/"];
const names = ["checker", "lib.es2023.collection", "a", "x".repeat(300), "ab"];
const endings = [".d.ts", ".d.mts", ".ts", ".d.css.ts", ".d.", "", ".D.ts"];
for (const folder of folders) {
  for (const name of names) {
    for (const ending of endings) {
      const flat = hidden(`${folder}${name}${ending}`.split("").join(""));
      const rope = hidden(hidden(folder) + hidden(name)) + hidden(ending);
      const padded = hidden("0123456789".repeat(4) + flat + "0123456789".repeat(4));
      const piece = hidden(padded.slice(40, 40 + flat.length));
      const pieceOfRope = hidden((hidden("<<<<<<<<<<<<<<<<<<<<") + rope + hidden(">>>>>>>>>>>>>>>>>>>>")).slice(20, 20 + flat.length));
      const at = flat.lastIndexOf(".d.");
      const expected = at >= 0 ? flat.substring(at) : undefined;
      for (const [kind, text] of [["flat", flat], ["rope", rope], ["piece", piece], ["piece of a rope", pieceOfRope]] as const) {
        note(`extension, ${kind}`, extensionOf(text), expected);
        note(`searches, ${kind}`, twoSearches(text), at * 1000 + flat.lastIndexOf("/"));
        note(`again, ${kind}`, extensionOf(text), expected);
      }
    }
  }
}

const digits = ["0012.5ab", "  42  ab", "1e3xxab", "abab", "٣٤ab", "-0ab"];
for (const head of digits) {
  const flat = hidden(head.split("").join(""));
  const rope = hidden(hidden(head.slice(0, 3)) + hidden("")) + hidden(head.slice(3));
  const long = hidden(hidden("#".repeat(30)) + hidden(head) + hidden("#".repeat(30)));
  for (let from = 0; from <= flat.length; from++) {
    for (let to = from; to <= flat.length; to++) {
      const piece = flat.substring(from, to);
      for (const [kind, text, shift] of [["flat", flat, 0], ["rope", rope, 0], ["long rope", long, 30]] as const) {
        note(`number, ${kind}`, pieceAndNumber(text, from + shift, to + shift), [piece, Number(piece)]);
        note(`test, ${kind}`, pieceAndTest(text, from + shift, to + shift), [piece, piece === "ab"]);
        for (let inner = 0; inner <= piece.length; inner++)
          note(`piece of a piece, ${kind}`, pieceOfPiece(text, from + shift, to + shift, inner), [piece, piece.substring(inner) === "ab"]);
      }
    }
  }
}

console.log(digest, wrong.length, wrong.slice(0, 5).join("\n"));
