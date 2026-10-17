// Regular expressions that are put together out of texts when a module is loaded, beside literals of the same text.
interface Edit {
  replace(name: string | RegExp, value: string | RegExp): Edit;
  getRegex(): RegExp;
}

function edit(source: string | RegExp, flags = ""): Edit {
  let text = typeof source === "string" ? source : source.source;
  const self: Edit = {
    replace(name: string | RegExp, value: string | RegExp) {
      let put = typeof value === "string" ? value : value.source;
      put = put.replace(/(^|[^\[])\^/g, "$1");
      text = text.replace(name, put);
      return self;
    },
    getRegex() {
      return new RegExp(text, flags);
    },
  };
  return self;
}

const bullet = /(?:[*+-]|\d{1,9}[.)])/;
const listItem = edit(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/)
  .replace(/bull/g, bullet)
  .getRegex();
const heading = edit("^ {0,3}(#{1,6})(?=\\s|$)(.*)(?:\\n+|$)").getRegex();
const words = ["alpha", "beta", "gamma"];
const anyWord = new RegExp("\\b(?:" + words.join("|") + ")\\b", "gi");
const sameAsLiteral = new RegExp("a+b", "g");
const literal = /a+b/g;

console.log(listItem.source, listItem.flags);
console.log(JSON.stringify(listItem.exec("  12. item\nrest")?.slice(0, 3)));
console.log(JSON.stringify(heading.exec("## title\n\nbody")?.slice(1, 3)));
console.log(JSON.stringify("Alpha and GAMMA, not alphabet".match(anyWord)));
console.log("caab aab".replace(sameAsLiteral, "<$&>"), "caab aab".replace(literal, "[$&]"));
console.log(sameAsLiteral.source === literal.source, sameAsLiteral.flags === literal.flags, sameAsLiteral === (literal as RegExp));
