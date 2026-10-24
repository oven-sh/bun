function deliver(value: string, resolve: (value: string) => void) { resolve("delivered " + value); }
function deliverLiteral(resolve: (value: string) => void) { resolve("delivered by a literal"); }

export class Later {
  constructor(public value: string) {}
  then(resolve: (value: string) => void) { deliver(this.value, resolve); }
}
export const literal = { then: deliverLiteral };
