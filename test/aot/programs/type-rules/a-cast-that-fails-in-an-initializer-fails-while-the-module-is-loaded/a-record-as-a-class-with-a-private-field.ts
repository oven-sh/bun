class Sealed { #secret = 1; open = 2; peek(): number { return this.#secret; } }
function asSealed(value: object): Sealed { return value as Sealed; }
export const made = asSealed({ open: 2 });
