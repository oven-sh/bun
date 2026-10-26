export default struct {
  a: number;
  b: number;
  constructor(a: number, b: number) {
    this.a = a;
    this.b = b;
  }
  sum(): number {
    return this.a + this.b;
  }
}
