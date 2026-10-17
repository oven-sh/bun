// A library written in TypeScript calls two methods through types whose parameters are `any` and passes both the same state object. Both methods see the same object.
function row(name: string, f: () => unknown): void {
  try {
    console.log(name + ": " + String(f()));
  } catch (e) {
    console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e)));
  }
}
function hide(v: unknown): any {
  return v;
}
interface Theme { dark: boolean }
interface From { theme: Theme; from: number }
interface Next { theme: Theme; n: number }
class Widget {
  static derive(step: number, state: From): From | null {
    return step !== state.from ? { theme: state.theme, from: step } : null;
  }
  should(next: Next): boolean {
    next.n += 1;
    return next.n > 0 && next.theme.dark;
  }
}
class Flat {
  static derive(step: number, state: { from: number }): { from: number } | null {
    return step !== state.from ? { from: step } : null;
  }
  should(next: { n: number }): boolean {
    next.n += 1;
    return next.n > 0;
  }
}
interface ComponentClass { derive?: (step: number, state: any) => unknown }
interface Instance { should?(next: any): boolean }
function drive(ctor: ComponentClass, instance: Instance, s: any): string {
  const d = ctor.derive;
  const part = typeof d === "function" ? d(1, s) : undefined;
  return String(part) + " " + (instance.should ? instance.should(s) : "-") + " " + s.n + " " + s.from;
}
const madeFrom: From = { theme: { dark: true }, from: 1 };
const madeNext: Next = { theme: { dark: true }, n: 1 };
row("typed code only", () => String(Widget.derive(1, madeFrom)) + " " + new Widget().should(madeNext));
row("library passes a typed literal", () => {
  const st = { theme: { dark: true }, from: 1, n: 3 }; return drive(Widget, new Widget(), st) + " " + st.n;
});
