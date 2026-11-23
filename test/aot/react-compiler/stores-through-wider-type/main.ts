// A component file stores through a type that is wider than the one the object was made as, which TypeScript accepts. The compiler's output does the same store as untyped code.
import { View } from "./View";

console.log(View({ title: "stores" }));
