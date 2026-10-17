const counts = typeof (globalThis as any).aotOperationCount === "function";
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const digests = () => count("Image::codeForRegExp digest");

function opening(tag: string) {
  return new RegExp("<" + tag + "(?=[\\s>])");
}
function closing(tag: string) {
  return new RegExp("</" + tag + "\\s*>", "g");
}
const atStart = digests();
const patterns = [opening("alpha"), opening("beta"), opening("gamma-ray"), opening("caf\xe9"), closing("alpha"), closing("beta"), closing("gamma-ray"), closing("\u4e2d\u6587")];
const made = digests() - atStart;
const text = "<alpha x><beta></beta ><gamma-ray>text</gamma-ray></alpha><caf\xe9 ></\u4e2d\u6587>";
console.log(patterns.map(pattern => `${pattern.source} ${pattern.flags} ${text.search(pattern)}`).join("\n"));
console.log(patterns.map(pattern => text.replace(pattern, "#").length).join(), patterns.map(pattern => pattern.test("<alpha>")).join());
const used = digests() - atStart - made;
console.log(!counts || (made === patterns.length && used === 0) ? "one digest a pattern" : `DIGESTS: ${made} where they are made, ${used} where they are used`);

const beforeTwin = digests();
const wideTwin = new RegExp(("\u4e2d<" + "alpha(?=[\\s>])").slice(1), "m");
console.log(wideTwin.source === patterns[0].source, wideTwin.flags, wideTwin.test(text), text.search(wideTwin));
console.log(!counts || digests() - beforeTwin === 1 ? "found, whichever way the string holds its characters" : `DIGESTS: ${digests() - beforeTwin}`);

const unseen = String(Math.floor(Math.random() * 900000) + 100000);
const beforeLong = digests();
const long = new RegExp("(a|" + unseen + ")" + "x".repeat(900000) + "$");
console.log(long.source.length, long.test(unseen + "x".repeat(900000)), long.test("c" + "x".repeat(900000)));
const near = [new RegExp("<alpha" + unseen + "(?=[\\s>])"), new RegExp("</" + unseen + "\\s*>", "g"), new RegExp("<" + unseen + "(?=[\\s>])")];
console.log(near.map(pattern => `${pattern.source.length} ${pattern.test(text)} ${pattern.test("<" + unseen + "></" + unseen + ">")}`).join(" "));
const forUnseen = digests() - beforeLong;
console.log(forUnseen === 0 ? "no digest of a pattern the build has not seen" : `DIGESTS OF PATTERNS THE BUILD HAS NOT SEEN: ${forUnseen}`);
