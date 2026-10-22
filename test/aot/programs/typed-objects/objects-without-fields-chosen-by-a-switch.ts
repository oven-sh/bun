// The cases of a switch that each make an object of a class without fields, and meet again. Such an object is the smallest cell there is, and making one leaves the object made before it as it was.
class A {}
class B {}
class C {}
function make(kind: number): object | null {
  let made: object | null;
  switch (kind) {
    case 0:
      made = new A();
      break;
    case 1:
      made = new B();
      break;
    case 2:
      made = new C();
      break;
    default:
      made = null;
  }
  return made;
}
const all: (object | null)[] = [];
for (let i = 0; i < 300; i++) all.push(make(i % 4));
const classes = [A, B, C];
let right = 0;
for (let i = 0; i < all.length; i++) {
  const made = all[i];
  if (i % 4 === 3 ? made === null : made instanceof classes[i % 4]!) right++;
}
console.log(right + " of " + all.length + " are of the class that made them");
