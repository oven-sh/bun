// One state object is passed to two methods whose parameter types each declare some of its properties. Both methods see the same object.
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
const madeFrom: From = { theme: { dark: true }, from: 1 };
const madeNext: Next = { theme: { dark: true }, n: 1 };
row("typed code only", () => String(Widget.derive(1, madeFrom)) + " " + new Widget().should(madeNext));
row("untyped caller", () => {
  const drive: any = hide((ctor: any, instance: any, s: any) => String(ctor.derive(1, s)) + " " + instance.should(s) + " " + s.n + " " + s.from); return drive(Widget, new Widget(), JSON.parse('{"theme":{"dark":true},"from":1,"n":3}'));
});
