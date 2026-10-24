class Animal {
  name = "animal";
}
class Dog extends Animal {
  legs = 4;
}
class Cat extends Animal {
  lives = "nine";
}
function rehome<T extends { pet: Animal }>(home: T): T {
  home.pet = new Cat();
  return home;
}
console.log("zq " + rehome({ pet: new Dog() }).pet.legs);
