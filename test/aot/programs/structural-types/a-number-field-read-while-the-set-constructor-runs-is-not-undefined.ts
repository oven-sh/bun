class Counting extends Set<number> {
  adds = 100;
  add(value: number): this {
    console.log("adds " + typeof this.adds + " " + this.adds);
    return super.add(value);
  }
}

console.log("size " + new Counting([1]).add(2).size);

export {};
