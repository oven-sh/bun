class CountingMap extends Map<string, number> {
  stores = 100;
  set(key: string, value: number): this {
    console.log("zq stores " + this.stores + " " + typeof this.stores);
    return super.set(key, value);
  }
}
const made = new CountingMap([["a", 1]]);
made.set("b", 2);
