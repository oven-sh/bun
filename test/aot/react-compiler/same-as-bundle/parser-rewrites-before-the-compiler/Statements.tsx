// Statements that --minify-syntax merges: in callbacks, in blocks and at the top level of a component.
import { useCallback, useMemo } from "react";
import { log, next } from "./counter";

export function JoinedInCallback({ a }: { a: number }) {
  "use memo";
  return useMemo(() => {
    log("callback " + a);
    return `${a} ${next()}`;
  }, [a]);
}

export function JoinedAtTop({ a }: { a: number }) {
  "use memo";
  log("top " + a);
  const id = next();
  return `${a} ${id}`;
}

export function BranchesInCallback({ a }: { a: number }) {
  "use memo";
  const choose = useCallback(
    (b: number) => {
      if (b > a) return [next(), b];
      if (b < a) {
        log("less");
        return [a];
      }
      return [next()];
    },
    [a],
  );
  return [choose(1), choose(2), choose(3)];
}

export function SingleUse({ a }: { a: number }) {
  "use memo";
  const make = () => {
    const first = next();
    const pair = [first, a];
    return pair;
  };
  const made = make();
  return made;
}

export function InBlocks({ a }: { a: number }) {
  "use memo";
  let text = "";
  for (const item of [a, a + 1]) {
    const id = next();
    text += item;
    text += id;
  }
  switch (a) {
    case 1: {
      log("one");
      text += next();
      break;
    }
    default:
      text += "other";
  }
  try {
    log("try");
    text += next();
  } finally {
    log("finally");
  }
  return text;
}

export function Conditions({ a, b }: { a: number; b?: { c?: number } | null }) {
  "use memo";
  const c = b?.c ?? next();
  const d = a ? next() : 0;
  if (a) log("a");
  if (!a) log("not a");
  else log("a again");
  return [c, d];
}
