function Tagged(Base: new (pattern: string) => object) {
  return class extends Base {
    tag = "tagged";
  };
}

const Made = Tagged(RegExp);
const made = new Made("a+");
console.log("own keys: " + Object.keys(made).join(" ") + " tag: " + made.tag);
console.log(made instanceof RegExp ? "source " + made.source + " test " + made.test("caat") + " replace " + "caat".replace(made, "-") : "no pattern");
console.log("instance: " + (made instanceof Made) + " own tag: " + Object.hasOwn(made, "tag"));
made.tag = "stored";
console.log("after a store: " + made.tag + " keys " + Object.keys(made).join(" "));
