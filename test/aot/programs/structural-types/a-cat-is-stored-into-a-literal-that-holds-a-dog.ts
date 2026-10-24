class Animal {
  name = "animal";
}

class Dog extends Animal {
  legs = 4;
}

class Cat extends Animal {
  lives = "nine";
}

const home = { pet: new Dog() };
const wide: { pet: Animal } = home;
wide.pet = new Cat();
console.log("legs", home.pet.legs, "name", home.pet.name);
