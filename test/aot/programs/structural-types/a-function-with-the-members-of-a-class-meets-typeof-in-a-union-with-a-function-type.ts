class Dog {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}
function use(h: (() => number) | Dog): number {
  return typeof h === "function" ? h() : h.bark();
}
const both: Dog = Object.assign(() => 77, new Dog(), { bark: () => 88 });
console.log(use(both));
