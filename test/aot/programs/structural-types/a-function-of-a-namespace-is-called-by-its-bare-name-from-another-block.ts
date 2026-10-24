function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

namespace Crew {
  export function who(this: unknown): string {
    return this === undefined ? "undefined" : this === Crew ? "the namespace" : typeof this;
  }
  export const arrow = (): string => "arrow";
  export let swapped: (this: unknown) => string = who;
  export class Member {
    rank: number = 1;
  }
  export function sameBlock(): string[] {
    return [who(), swapped(), arrow()];
  }
}

namespace Crew {
  export function otherBlock(): string[] {
    return [who(), swapped(), arrow()];
  }
  export function tagged(): string {
    return tag`x`;
  }
  export function made(): number {
    return new Member().rank;
  }
  export class Officer extends Member {
    stars: number = 2;
  }
  export function passed(): string {
    return [who].map(f => f())[0];
  }
  export function kinds(): string[] {
    return [typeof who, typeof Member, typeof tag, typeof missing];
  }
}

namespace Crew {
  export function tag(this: unknown, strings: TemplateStringsArray): string {
    return strings[0] + " " + (this === undefined ? "undefined" : this === Crew ? "the namespace" : typeof this);
  }
  export declare const missing: number;
}

show("this in the block that declares the function", () => Crew.sameBlock());
show("this in another block", () => Crew.otherBlock());
show("this from outside", () => [Crew.who(), Crew.swapped(), (0, Crew.who)()]);
show("as a tag from an earlier block", () => Crew.tagged());
show("a class of another block constructed", () => Crew.made());
show("a class of another block extended", () => [new Crew.Officer().rank, new Crew.Officer().stars, Object.keys(new Crew.Officer()), new Crew.Officer() instanceof Crew.Member]);
show("handed on as a value", () => Crew.passed());
show("typeof", () => Crew.kinds());

Crew.swapped = function (this: unknown): string {
  return "swapped " + (this === Crew ? "the namespace" : typeof this);
};
show("after the variable is stored to from outside", () => [Crew.sameBlock(), Crew.otherBlock()]);

const writable: { who: (this: unknown) => string } = Crew;
writable.who = () => "replaced";
show("after the function is replaced through a view", () => [Crew.sameBlock(), Crew.otherBlock(), Crew.who()]);
