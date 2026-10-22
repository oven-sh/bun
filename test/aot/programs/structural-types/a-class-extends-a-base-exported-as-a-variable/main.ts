import { Current } from "./base.ts";

class Derived extends Current {
  extra = "d";
  twice(): number {
    return this.sum() * 2;
  }
}

const made = new Derived();
console.log("keys: " + Object.keys(made).join(" "));
console.log("json: " + JSON.stringify(made));
console.log("members: " + made.x + " " + made.y + " " + made.extra + " " + made.sum() + " " + made.twice());
console.log("kinds: " + typeof made.x + " " + typeof made.y + " " + typeof made.extra);
console.log("instance: " + (made instanceof Derived) + " " + (made instanceof Current));
made.x = 10;
made.extra = "stored";
console.log("after stores: " + JSON.stringify(made) + " " + made.sum());
