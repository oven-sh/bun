function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

function Tagged(Base: new () => object) {
  return class extends Base {
    tag = "tagged";
  };
}

const Made = Tagged(Set);
const made = new Made();
console.log("own keys: " + Object.keys(made).join(" ") + " tag: " + made.tag);
console.log(made instanceof Set ? "size " + made.add(1).size : "no set");
console.log("instance: " + (made instanceof Made) + " own tag: " + Object.hasOwn(made, "tag"));
made.tag = "stored";
console.log("after a store: " + made.tag + " keys " + Object.keys(made).join(" "));
