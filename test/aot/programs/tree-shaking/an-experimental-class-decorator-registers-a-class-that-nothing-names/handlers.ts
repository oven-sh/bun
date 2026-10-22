import { register } from "./registry";

function shout(text: string): string {
  return text.toUpperCase();
}

@register("first")
export class First {
  run(): string {
    return shout("first ran");
  }
}

@register("second")
class Second {
  run(): string {
    return shout("second ran");
  }
}
