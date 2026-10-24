class Counting extends Map<string, number> {
  stores = 100;
  set(key: string, value: number): this {
    console.log("stores " + typeof this.stores + " " + this.stores);
    return super.set(key, value);
  }
}

console.log("size " + new Counting([["k", 1]]).size);

export {};
