class Bare extends null {
  constructor() {
    return Object.create(new.target.prototype);
  }
  hello(): string {
    return "a method of the bare class";
  }
}

const made = new Bare();
console.log(made.hello());
console.log("instance: " + (made instanceof Bare) + " " + (made instanceof Object));
console.log("has toString: " + ("toString" in made));
console.log("keys: [" + Object.keys(made).join(" ") + "]");
