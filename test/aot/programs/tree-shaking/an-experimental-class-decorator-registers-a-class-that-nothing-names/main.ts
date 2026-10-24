// The same with experimentalDecorators, for a class of this file and for exported classes of a file that is imported for its effects only.
import { registry, register } from "./registry";
import "./handlers";

@register("local")
class Local {
  run(): string {
    return "local ran";
  }
}

for (const [name, entry] of registry) console.log(name, new entry().run());
