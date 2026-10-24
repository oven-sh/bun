class Animal {
  title: string = "animal";
}
class Dog extends Animal {
  legs: number = 4;
}
class Cat extends Animal {
  lives: string = "nine";
}
interface Home {
  pet: Animal;
}
class DogHome implements Home {
  current: Dog = new Dog();
  get pet(): Dog {
    return this.current;
  }
  set pet(d: Dog) {
    this.current = d;
  }
}
function move(home: Home, a: Animal): void {
  home.pet = a;
}
const home = new DogHome();
move(home, new Cat());
console.log("legs " + home.pet.legs);
