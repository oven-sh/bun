import { Dog } from "./library.js";

class Puppy extends Dog {
  small = true;
}

const puppy = new Puppy("pup");
console.log(Object.keys(puppy).join());
console.log(JSON.stringify(puppy));
console.log(puppy.title, Object.hasOwn(puppy, "title"), "title" in puppy);
console.log(Object.keys(new Dog("rex")).join());
