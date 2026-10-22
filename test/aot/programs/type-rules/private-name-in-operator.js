// `#a in o` inside the class that declares `#a` is valid JavaScript. The build accepts it, and it answers without throwing.
class A {
  #a = 1;
  static has(o) { return #a in o; }
}
console.log(A.has(new A()));
console.log(A.has({}));
