const object: any = {};
object.__defineGetter__("a", () => 1);
object.__defineSetter__("a", function (this: any, value: number) {
  this.b = value;
});
object.a = 5;
console.log(
  object.a,
  object.b,
  typeof object.__lookupGetter__("a"),
  typeof object.__lookupSetter__("a"),
  object.__lookupGetter__("b"),
  Object.create(object).__lookupGetter__("a") === object.__lookupGetter__("a"),
);
