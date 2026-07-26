// index.ts
import "reflect-metadata";
// `container` is assigned via Object.defineProperty(exports, "container", ...) and is
// statically detectable; `singleton` comes through a tslib __exportStar re-export
// (Node's cjs-module-lexer follows those cross-file, Bun does not yet), so read it
// from the default export.
import tsyringe, { container } from "tsyringe";
const { singleton } = tsyringe;

@singleton()
class A {
  constructor() {
    console.log("A");
  }
}

container.resolve(A);
