// middle.ts hands its namespace import on as a default export, as a const, inside an object and as the result of a function. The exports of lib.ts are named only behind those.
import whole, { api, box, get } from "./middle";

console.log(whole.throughDefault());
console.log(api.throughConst());
console.log(box.lib.throughObject());
console.log(get().throughFunction());
console.log((whole as any)["through" + "Computed"]());
