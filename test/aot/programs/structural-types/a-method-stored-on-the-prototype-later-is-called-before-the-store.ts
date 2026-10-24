interface Dog {
  roll(times: number): number;
}
class Dog {
  legs: number = 4;
}

function install(): void {
  Dog.prototype.roll = function (this: Dog, times: number): number {
    return this.legs * times;
  };
}

const dog = new Dog();
try {
  console.log("before the store " + dog.roll(2));
} catch (error) {
  console.log("before the store " + (error instanceof TypeError ? "TypeError" : "another error"));
}
console.log("typeof " + typeof dog.roll);
install();
console.log("after the store " + dog.roll(2));
