import * as ast from "./ast";
import * as patterns from "./patterns";
export declare namespace Struct {
  type Objects = { readonly ast: ast.Objects<number>; readonly options: ast.Options };
  interface Options {
    readonly rest: boolean;
  }
}
export function Struct<S extends Struct.Objects>(schema: S, options: Struct.Options): number[] {
  return options.rest && schema.options.strict ? ast.fieldsOf(schema.ast) : [];
}
export const empty = new ast.Objects<number>([]);
export function pick<Objects extends string>(name: Objects, from: ast.Objects<Objects>): Objects | undefined {
  return from.fields.find(field => field === name);
}
export function first<T extends readonly unknown[]>(list: T): patterns.infer<T> | undefined {
  return list[0] as patterns.infer<T> | undefined;
}
export { fields, Scope } from "./scope";
export { trace } from "./tracer";
