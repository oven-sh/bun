// Functions the compiler may skip or bail out of.
import { next } from "./counter";

export function OptedOut({ a }: { a: number }) {
  "use no memo";
  return [a, next()];
}

export function Suppressed({ a }: { a: number }) {
  "use memo";
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return [a, next()];
}

export function WithThis(this: void, { a }: { a: number }) {
  "use memo";
  return [a, next()];
}

export function Disposes({ a }: { a: number }) {
  "use memo";
  using resource = { [Symbol.dispose]() {} };
  return [a, next(), typeof resource];
}

export function HasClass({ a }: { a: number }) {
  "use memo";
  class Local {
    value = next();
  }
  return [a, new Local().value];
}

export function OptedIn({ a }: { a: number }) {
  "use memo";
  return [a, next()];
}

export function notAComponent({ a }: { a: number }) {
  return [a, next()];
}

export function useValue(a: number) {
  return [a, next()];
}

export function UsesHook({ a }: { a: number }) {
  return [useValue(a), useValue(a + 1)];
}

const decorated: string[] = [];
function listed<Class extends new () => object>(target: Class, context: ClassDecoratorContext): Class {
  decorated.push(context.kind);
  return target;
}

@listed
class Model {
  value = next();
}

export function UsesDecoratedClass({ a }: { a: number }) {
  "use memo";
  return [a, new Model().value, decorated];
}
