// RegExp.input, lastMatch, leftContext, rightContext, lastParen and $1 after chains of replacements that are done in one pass: read at once, read twice, read after a collection, after another match, after an assignment to RegExp.input, after a chain that found nothing.
const report: string[] = [];
const legacy = RegExp as unknown as Record<string, string>;
function all(): string {
  return [legacy.input, legacy.lastMatch, legacy.leftContext, legacy.rightContext, legacy.lastParen, legacy.$1, legacy.$_].map(text => "[" + text + "]").join("");
}
function quote(text: string): string {
  return text.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F");
}
function blank(text: string): string {
  return text.replace(/[0-9a-f]+/g, "x").replace(/\s/g, ".");
}
function makeGarbage(): number {
  let kept = 0;
  for (let i = 0; i < 30000; i++) kept += [String(i), i].length + { i }.i;
  return kept;
}
for (const text of ["50%", "a#b?c%d", "fade 12 cab", "zzz", "", "??##", "%"]) {
  quote(text);
  report.push("at once " + all());
  quote(text);
  blank(text);
  report.push("second chain " + all());
  blank(text);
  quote(text);
  makeGarbage();
  report.push("after a collection " + all() + all());
  quote(text + "#");
  /(o|r)+/.exec("door");
  report.push("another match behind " + all());
  /(o|r)+/.exec("door");
  quote(text + "?");
  report.push("another match ahead " + legacy.rightContext + "|" + legacy.leftContext + "|" + legacy.input);
  quote("%" + text);
  legacy.input = "assigned";
  report.push("assigned " + all());
  blank(text + " 0");
  report.push("input alone " + legacy.input);
  blank("f " + text);
  "untouched".replace(/Q/g, "q").replace(/Z/g, "z");
  report.push("nothing found behind " + legacy.lastMatch + "|" + legacy.input);
}
console.log(report.join("\n"));
