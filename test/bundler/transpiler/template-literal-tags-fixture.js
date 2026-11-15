const strings = (strings, ...values) => strings;
const site = () => strings`é${1}日本`;
const order = [];
const object = {
  name: "object",
  tag(strings, ...values) {
    return [this.name, strings.raw.join("|"), ...values];
  },
};
class Base {
  tag(strings) {
    return [this.name, strings.raw[0]];
  }
}
class Derived extends Base {
  name = "derived";
  #tag(strings) {
    return [this.name, strings.raw[0]];
  }
  run() {
    return [super.tag`ü`, this.#tag`ø`];
  }
}
function Made(strings) {
  return function () {
    this.raw = strings.raw[0];
  };
}
console.log(
  JSON.stringify({
    raw: [String.raw`😀`, String.raw`a${1}é${2}日本`, String.raw`{"a":"😀"}`],
    cooked: [...strings`😀\n${0}é`],
    ownEscapes: strings`\u{1f600}😀\xe9é`.raw,
    invalidEscape: [strings`\u{zz}é`[0] === undefined, strings`\u{zz}é`.raw[0]],
    newline: strings`é
é`.raw,
    sameSite: site() === site(),
    otherSite: strings`é` === strings`é`,
    frozen: [Object.isFrozen(site()), Object.isFrozen(site().raw), Array.isArray(site()), Array.isArray(site().raw)],
    rawDescriptor: Object.getOwnPropertyDescriptor(site(), "raw").enumerable,
    length: [site().length, site().raw.length],
    member: [object.tag`é${1}ü${2}`, object["tag"]`é`],
    classes: new Derived().run(),
    constructed: new Made`é`().raw,
    order: ((order.push("tag"), strings)`é${order.push("first")}ü${order.push("second")}`, order),
    ascii: String.raw`\u{1f600}\n`,
    nested: String.raw`é${String.raw`ü${"x"}`}`,
  }),
);
