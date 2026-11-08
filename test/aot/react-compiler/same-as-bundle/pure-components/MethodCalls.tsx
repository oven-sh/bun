// A statement in an argument mutates the receiver of the call. The compiler reads the method ahead of the statement, and calls it with the receiver given.
type Props = { a: number; text: string };
type Named = { name: string; who: (this: Named, suffix?: string) => string; inner?: Named };

function who(this: Named, suffix = "") {
  return this.name + ":old" + suffix;
}
function other(this: Named) {
  return this.name + ":new";
}
const make = (name: string): Named => ({ name, who });

export function StatementReplacesTheMethod({ a, text }: Props) {
  "use memo";
  const named = make(text + a);
  return [
    named.who(
      (() => {
        named.who = other;
        return "!";
      })(),
    ),
  ];
}

export function ReceiverIsAPropertyLoad({ a, text }: Props) {
  "use memo";
  const outer = { inner: make(text + a) };
  return [
    outer.inner.who(
      (() => {
        outer.inner.who = other;
        return "!";
      })(),
    ),
  ];
}

export function KeyIsAMemberThatIsUpdated({ a, text }: Props) {
  "use memo";
  const parts = [(n: number) => text + ":first:" + n, (n: number) => text + ":second:" + n];
  const state = { i: a % 2 };
  return [parts[state.i](state.i++), state.i];
}
