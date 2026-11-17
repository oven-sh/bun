// Every component is a pure function of its props, so memoizing must not change what it returns.
import { useCallback, useMemo } from "react";

type Props = { a: number; text: string; list: number[]; nested?: { value?: number | null } | null };

const OFFSET = 10;
enum Kind {
  Even = "even",
  Odd = "odd",
}

export function Arithmetic({ a }: Props) {
  "use memo";
  return [a + 1 + 2, 1 + 2 + a, a * 2 ** 3, -a, +a, ~a, a % 3, a / 4, (a << 2) | 1, a > 1 === true, OFFSET + a];
}

export function Conditions({ a, nested }: Props) {
  "use memo";
  const value = nested?.value ?? -1;
  const kind = a % 2 === 0 ? Kind.Even : Kind.Odd;
  let size;
  if (a > 1) size = "large";
  else if (a === 1) size = "one";
  else size = "small";
  return { value, kind, size, both: a && value, either: a || value, not: !a, twice: !!a };
}

export function Objects({ a, text, list }: Props) {
  "use memo";
  const key = "k" + a;
  const base = { a, text, [key]: list, "quoted-key": 1, 2: "two" };
  const { a: renamed, ...rest } = base;
  return { ...rest, renamed, list: [...list, a], first: list[0], last: list.at(-1), has: "text" in base };
}

export function Loops({ a, list }: Props) {
  "use memo";
  const out: (number | string)[] = [];
  for (const item of list) {
    if (item === a) continue;
    out.push(item * 2);
  }
  for (let i = 0; i < a; i++) out.push("i" + i);
  for (const key in { x: 1, y: 2 }) out.push(key);
  let n = a;
  while (n > 0) {
    out.push(n);
    n--;
  }
  outer: for (const x of list) {
    for (const y of list) {
      if (x + y > 4) break outer;
      out.push(x + y);
    }
  }
  return out;
}

export function Branches({ a, text }: Props) {
  "use memo";
  const out: string[] = [];
  switch (a) {
    case 1:
      out.push("one");
    case 2:
      out.push("two or below");
      break;
    default:
      out.push("other");
  }
  try {
    if (a === 2) throw new Error(text);
    out.push("no error");
  } catch (error) {
    out.push("caught");
    out.push((error as Error).message);
  } finally {
    out.push("finally");
  }
  return out;
}

export function Closures({ a, list }: Props) {
  "use memo";
  const add = useCallback((n: number) => n + a, [a]);
  const sums = useMemo(() => {
    const mapped = list.map(add);
    const total = mapped.reduce((sum, n) => sum + n, 0);
    return { mapped, total };
  }, [list, add]);
  const make = (n = a, { twice = n * 2 } = {}) => [n, twice];
  return [sums, make(), make(5), make(5, { twice: 1 }), list.filter(n => n > a).map(n => ({ n }))];
}

export function Text({ a, text }: Props) {
  "use memo";
  return [`${text}`, `${a}${text}`, `<${text}>`, text + a, a + text, text.toUpperCase(), `line\nbreak\t${a}`, typeof a, typeof text, String(a)];
}

function Row({ a, children }: { a: number; children?: unknown }) {
  return (
    <li title={"row " + a}>
      {a}
      {children}
    </li>
  );
}

export function Elements({ a, text, list }: Props) {
  return (
    <ul className="list">
      {list.map(n => (
        <Row key={n} a={n + a} />
      ))}
      <Row a={a}>{text}</Row>
      {a > 1 ? <Row a={0} /> : null}
      <>
        plain text &lt;escaped&gt;
        {text}
      </>
    </ul>
  );
}
