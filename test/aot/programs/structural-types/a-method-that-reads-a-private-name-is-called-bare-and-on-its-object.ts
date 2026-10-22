class Subject {
  #secret: number = 42;
  readSecret(): number {
    return this.#secret;
  }
}
const s = new Subject();
const readSecret = s.readSecret;
try {
  console.log("gives " + readSecret());
} catch (error) {
  console.log("threw " + (error instanceof TypeError));
}
console.log("gives " + s.readSecret());
