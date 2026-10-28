function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

namespace Settings {
  export const early: string = describe();
  export const depth: number = 3;
  export let width: number = 4;
  export var height: number = 5;
  export class Panel {
    size: number = 6;
  }
  export function describe(): string {
    const parts: string[] = [];
    const uses: [string, () => unknown][] = [
      ["depth", () => depth],
      ["depth + 1", () => depth + 1],
      ["width", () => width],
      ["height", () => height],
      ["panel", () => new Panel().size],
      ["hidden", () => hidden],
    ];
    for (const [label, use] of uses) {
      try {
        const value = use();
        parts.push(label + " " + typeof value + " " + String(value));
      } catch (error) {
        parts.push(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
      }
    }
    return parts.join(", ");
  }
  const hidden: number = 7;
}

namespace Settings {
  export const second: number = depth + 1;
}

show("early", () => Settings.early);
show("late", () => Settings.describe());
show("second part", () => Settings.second);
show("keys", () => Object.keys(Settings).join());

const alias: { depth: number; width: number } = Settings;
alias.depth = 30;
alias.width = 40;
show("after stores through an alias", () => Settings.describe());
show("depth from outside", () => Settings.depth);
show("width from outside", () => Settings.width);

function early(): string {
  try {
    return String(Later.value);
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}
show("a namespace used before it runs", early);
namespace Later {
  export const value: number = 8;
}
show("and after", early);
