// A function expression reads its own name in a callback. That name is the function: not the `const` around it, and not another binding of the
// name inside the function.
import { forwardRef, memo } from "react";

type Props = { a: number; text: string; list: number[] };

export const SameName = memo(function SameName({ a, list }: Props): string {
  return <ul>{[...list].map(n => (n > a + 1 ? <SameName a={n} text="" list={[]} /> : n))}</ul>;
});

export const OtherName = memo(function Inner({ a, list }: Props): string {
  return <ol>{[...list].map(n => (n > a + 1 ? <Inner a={n} text="" list={[]} /> : n))}</ol>;
});

export const Forwarded = forwardRef(function Forwarded({ a, list }: Props, ref: unknown): string {
  return <dl ref={ref}>{[...list].map(n => (n > a + 1 ? <Forwarded a={n} text="" list={[]} /> : n))}</dl>;
});

export const NotATag = memo(function NotATag({ a, list }: Props): string {
  return <p>{[...list].map(n => typeof NotATag + (NotATag.length + n + a))}</p>;
});

// The name is one that the compiler gives: its parameter `t0`, a temporary `t1`, its cache `$`.
export const NamedLikeTheParameter = memo(function t0({ a, list }: Props): string {
  return <p>{[...list].map(n => typeof t0 + (t0.length + n + a))}</p>;
});

export const NamedLikeATemporary = memo(function t1({ a, list }: Props): string {
  return <p>{[...list].map(n => typeof t1 + (t1.length + n + a))}</p>;
});

export const NamedLikeTheCache = memo(function $({ a, list }: Props): string {
  return <p>{[...list].map(n => typeof $ + ($.length + n + a))}</p>;
});

export const ParameterOfTheName = memo(function ParameterOfTheName({ a, list }: Props): string {
  const first = list.map(ParameterOfTheName => ParameterOfTheName + a);
  return (
    <p>
      {first.join()}
      {[...list].map(n => (n > a + 1 ? <ParameterOfTheName a={n} text="" list={[]} /> : n))}
    </p>
  );
});

export const LocalOfTheName = memo(function LocalOfTheName({ a, list }: Props): string {
  let first;
  {
    const LocalOfTheName = [a];
    LocalOfTheName.push(list.length);
    first = LocalOfTheName;
  }
  return (
    <p>
      {first.join()}
      {[...list].map(n => (n > a + 1 ? <LocalOfTheName a={n} text="" list={[]} /> : n))}
    </p>
  );
});
