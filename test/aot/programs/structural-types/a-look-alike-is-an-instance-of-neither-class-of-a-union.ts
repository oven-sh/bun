class Cat {
  name = "cat";
  lives = 9;
}
class Dog {
  name = "dog";
  tricks = 3;
}

function describe(pet: Cat | Dog): string {
  if (pet instanceof Cat) return "cat " + pet.lives;
  if (pet instanceof Dog) return "dog " + pet.tricks;
  return "neither, undefined: " + (pet === undefined) + ", null: " + (pet === null) + ", an object: " + (typeof pet === "object");
}

const fake: Cat = { name: "fake", lives: 1 };
console.log(describe(new Cat()));
console.log(describe(new Dog()));
console.log(describe(fake));
