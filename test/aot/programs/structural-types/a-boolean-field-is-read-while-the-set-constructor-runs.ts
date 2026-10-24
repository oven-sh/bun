class Counting extends Set<number> {
  flag = true;
  add(value: number): this {
    console.log("flag " + typeof this.flag + " " + this.flag + " " + (this.flag ? "taken as true" : "taken as false"));
    return super.add(value);
  }
}

console.log("size " + new Counting([1]).add(2).size);

export {};
