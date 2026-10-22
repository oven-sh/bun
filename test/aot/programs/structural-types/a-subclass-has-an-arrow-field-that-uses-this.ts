class Base {}
class Arrow extends Base {
  count: number = 1;
  handler: () => number = () => this.count;
}
console.log("gives " + new Arrow().handler());
