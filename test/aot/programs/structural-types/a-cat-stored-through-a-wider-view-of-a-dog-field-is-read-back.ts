class Animal {
  title: string = "animal";
}
class Dog extends Animal {
  legs: number = 4;
}
class Cat extends Animal {
  lives: string = "nine";
}
class Home {
  pet: Dog = new Dog();
}
const home = new Home();
const wide: { pet: Animal } = home;
wide.pet = new Cat();
console.log("legs " + home.pet.legs);
