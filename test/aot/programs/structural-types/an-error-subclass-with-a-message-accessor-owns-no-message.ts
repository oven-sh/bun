class Computed extends Error {
  get message(): string {
    return "computed";
  }
}

console.log("own " + Object.hasOwn(new Computed(), "message") + ", names " + Object.getOwnPropertyNames(new Computed()).filter(name => name === "message").length);

export {};
