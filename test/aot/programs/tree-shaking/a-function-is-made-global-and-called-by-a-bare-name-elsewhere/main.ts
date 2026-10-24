// setup.ts stores functions into globalThis, by a member, by a computed name, by Object.assign and by defineProperty. The other files call them by bare names, which belong to no binding.
import "./setup";
import { useThem } from "./user";

declare function byMember(): string;

console.log(byMember());
console.log(useThem());
