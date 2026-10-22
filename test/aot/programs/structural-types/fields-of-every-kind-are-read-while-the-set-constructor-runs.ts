class Counting extends Set<number> {
  name = "counting";
  list = [1, 2];
  flag = true;
  inner = { depth: 1 };
  whole = 7;
  half = 0.5;
  add(value: number): this {
    console.log([typeof this.name, typeof this.list, typeof this.flag, typeof this.inner, typeof this.whole, typeof this.half].join(" "));
    console.log(String(this.name) + " " + String(this.list) + " " + String(this.flag) + " " + String(this.inner) + " " + String(this.whole) + " " + String(this.half));
    try {
      console.log("length " + this.name.length);
    } catch (error) {
      console.log("the name: threw " + (error instanceof TypeError));
    }
    try {
      console.log("first " + this.list[0]);
    } catch (error) {
      console.log("the list: threw " + (error instanceof TypeError));
    }
    try {
      console.log("depth " + this.inner.depth);
    } catch (error) {
      console.log("the object: threw " + (error instanceof TypeError));
    }
    return super.add(value);
  }
}

console.log("size " + new Counting([1]).add(2).size);

export {};
