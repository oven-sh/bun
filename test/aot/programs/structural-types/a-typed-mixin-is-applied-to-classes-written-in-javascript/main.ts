function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

import { Modern, Old } from "./bases.js";

function Tagged(Base: new () => object) {
  return class extends Base {
    tag = "tagged";
  };
}

console.log(describe(new (Tagged(Modern))()));
console.log(describe(new (Tagged(Old))()));
console.log(describe(new (Tagged(Tagged(Modern)))()));
console.log("instance: " + (new (Tagged(Modern))() instanceof Modern) + " " + (new (Tagged(Old))() instanceof Old));
