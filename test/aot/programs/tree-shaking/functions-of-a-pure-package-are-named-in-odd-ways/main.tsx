// "sideEffects": false, and each import of the package has one use that is no plain identifier: a JSX tag, a member tag, the factory of a pragma, a decorator, a shorthand property, an export clause and a heritage clause. `bun run` also prints "unused.js is evaluated". `bun build --compile` leaves that file out, and --aot follows it.
/* @jsxRuntime classic */
/* @jsx h */
import { h, Tag, mark, shorthand, reexported, Base } from "odd";
import * as odd from "odd";
import * as self from "./main";

export { reexported };

@mark
class Derived extends Base {}

console.log(<Tag />, <odd.MemberTag />);
console.log({ shorthand }.shorthand(), self.reexported(), new Derived().method(), (Derived as any).marked);
