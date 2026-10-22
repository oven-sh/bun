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

interface Button {
  step: (n: number) => number;
}
class Button {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  press(): number {
    return this.step(this.id);
  }
}

function filled(id: number): Button {
  const button = new Button(id);
  button.step = id % 2 === 0 ? n => n + 1 : n => n * 2;
  return button;
}

function pressed(button: Button, n: number): number {
  return button.step(n);
}

function stepOf(button: Button): (n: number) => number {
  return button.step;
}

show("the first call gets one without it", () => pressed(new Button(1), 1));
show("read", () => stepOf(new Button(1)));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += pressed(filled(i), i) + filled(i).press() + stepOf(filled(i))(1);
show("2000 with it", () => sum);
show("one without it", () => pressed(new Button(5), 1));
show("its method", () => new Button(5).press());
show("read", () => stepOf(new Button(5)));
show("one with it again", () => [pressed(filled(2), 1), filled(3).press()]);

show("three, the second without", () => {
  const seen: string[] = [];
  for (const button of [filled(1), new Button(2), filled(4)]) {
    try {
      seen.push(String(pressed(button, 10)));
    } catch (error) {
      seen.push(error instanceof TypeError ? "TypeError" : "another error");
    }
  }
  return seen;
});
show("keys of both", () => [Object.keys(filled(1)), Object.keys(new Button(1))]);

const late = new Button(3);
show("before the store", () => [typeof late.step, "step" in late]);
late.step = n => n - 1;
show("after the store", () => [typeof late.step, "step" in late, late.press(), pressed(late, 1)]);
