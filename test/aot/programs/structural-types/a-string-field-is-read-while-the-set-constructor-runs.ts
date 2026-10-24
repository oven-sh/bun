class Counting extends Set<number> {
  name = "counting";
  add(value: number): this {
    try {
      console.log("length " + this.name.length);
    } catch (error) {
      console.log("threw " + (error instanceof TypeError));
    }
    return super.add(value);
  }
}

console.log("size " + new Counting([1]).add(2).size);

export {};
