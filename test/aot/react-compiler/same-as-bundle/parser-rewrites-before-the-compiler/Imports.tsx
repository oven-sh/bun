// Names the parser rewrites: members of a namespace import, require(), import().
import * as counter from "./counter";
import * as React from "react";

export function NamespaceMember({ a }: { a: number }) {
  "use memo";
  const list = [a, counter.next(), counter.LIMIT];
  return list;
}

export function NamespaceHook({ a }: { a: number }) {
  "use memo";
  return React.useMemo(() => [a, counter.next()], [a]);
}

export function Required({ a }: { a: number }) {
  "use memo";
  const required: typeof counter = require("./counter");
  const list = [a, required.next()];
  return list;
}

const { next: nextByRequire } = require("./counter") as typeof counter;

export function RequiredOutside({ a }: { a: number }) {
  "use memo";
  return [a, nextByRequire()];
}

export function Imported({ a }: { a: number }) {
  "use memo";
  const loading = import("./counter").then(loaded => loaded.LIMIT + a);
  return [typeof loading.then, later(a)];
}

function later(a: number): string {
  return "later " + a;
}

export const Wrapped = React.memo(function Wrapped({ a }: { a: number }) {
  "use memo";
  return [a, counter.next()];
});

export const Forwarded = React.forwardRef(({ a }: { a: number }, ref: unknown) => <p>{[a, ref, counter.next()]}</p>);

export const Arrow = ({ a }: { a: number }) => <p>{[a, counter.next()]}</p>;

export default function ({ a }: { a: number }) {
  "use memo";
  return [a, counter.next()];
}
