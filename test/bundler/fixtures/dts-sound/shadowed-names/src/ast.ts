export class Objects<Field = string> {
  constructor(readonly fields: Field[]) {}
}
export interface Options {
  readonly strict: boolean;
}
export function fieldsOf<Field>(ast: Objects<Field>): Field[] {
  return ast.fields;
}
