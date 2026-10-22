class Dog {
  legs = 4;
}
interface Dog {
  wag(): number;
}
function installWag(): void {
  Dog.prototype.wag = function (this: Dog): number {
    return this.legs * 10;
  };
}
try {
  console.log("zq before " + new Dog().wag());
} catch (error) {
  console.log("zq before: threw a TypeError: " + (error instanceof TypeError));
}
installWag();
console.log("zq after " + new Dog().wag());
