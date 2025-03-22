// index.ts
import "reflect-metadata";
import { container, singleton } from "tsyringe";

@singleton()
class A {
  constructor() {
    console.log("A");
  }
}

container.resolve(A);
