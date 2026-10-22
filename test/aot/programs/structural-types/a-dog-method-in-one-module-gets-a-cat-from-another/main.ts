import { Dog } from "./animals.ts";
import { honest, honestLegs } from "./honest.ts";
import { makeImpostor, tryAll } from "./impostor.ts";
import { keeper } from "./keeper.ts";

console.log("honest: " + honest(new Dog("rex")));
console.log("2000 honest: " + honestLegs(2000));
for (const line of tryAll(keeper, makeImpostor())) console.log("cat " + line);
for (const line of tryAll(keeper, new Dog("fido"))) console.log("dog " + line);
console.log("honest again: " + honest(new Dog("rex")));
