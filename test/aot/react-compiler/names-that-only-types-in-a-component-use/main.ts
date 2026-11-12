// What replaces the body of a component has none of its type syntax. A name that only a cast, an annotation or a `typeof` in that body uses is still used.
import { Field } from "./Field";

console.log(Field({ rows: [{ id: 7 }], label: "kept" }));
