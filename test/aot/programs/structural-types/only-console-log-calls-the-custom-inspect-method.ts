class Secret {
  value = "hidden";
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "a secret of " + this.value.length + " letters";
  }
}

console.log(new Secret());
console.log([new Secret()]);
console.log(Bun.inspect(new Secret()));

export {};
