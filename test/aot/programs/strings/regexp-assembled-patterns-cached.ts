function opening(tag: string) {
  return new RegExp("<" + tag + "(?=[\\s>])");
}
function closing(tag: string) {
  return new RegExp("</" + tag + "\\s*>", "g");
}
const patterns = [opening("alpha"), opening("beta"), opening("gamma-ray"), opening("caf\xe9"), closing("alpha"), closing("beta"), closing("gamma-ray"), closing("\u4e2d\u6587")];
const text = "<alpha x><beta></beta ><gamma-ray>text</gamma-ray></alpha><caf\xe9 ></\u4e2d\u6587>";
console.log(patterns.map(pattern => `${pattern.source} ${pattern.flags} ${text.search(pattern)}`).join("\n"));
console.log(patterns.map(pattern => text.replace(pattern, "#").length).join(), patterns.map(pattern => pattern.test("<alpha>")).join());

const wideTwin = new RegExp(("\u4e2d<" + "alpha(?=[\\s>])").slice(1), "m");
console.log(wideTwin.source === patterns[0].source, wideTwin.flags, wideTwin.test(text), text.search(wideTwin));

const unseen = String(Math.floor(Math.random() * 900000) + 100000);
const long = new RegExp("(a|" + unseen + ")" + "x".repeat(900000) + "$");
console.log(long.source.length, long.test(unseen + "x".repeat(900000)), long.test("c" + "x".repeat(900000)));
const near = [new RegExp("<alpha" + unseen + "(?=[\\s>])"), new RegExp("</" + unseen + "\\s*>", "g"), new RegExp("<" + unseen + "(?=[\\s>])")];
console.log(near.map(pattern => `${pattern.source.length} ${pattern.test(text)} ${pattern.test("<" + unseen + "></" + unseen + ">")}`).join(" "));
