import type * as Scope from "./scope";
interface Scope {
  readonly name: string;
}
export function trace(parent: Scope.Scope, name: string): Scope | undefined {
  const scope: Scope = { name };
  return parent.closed ? undefined : scope;
}
