export interface Options { depth: number; label?: string }

export class Boom extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

export class Thing {
  #secret = 1;
  constructor(public readonly options: Options) {
    if (options.depth < 0)
      throw new Boom(
        "negative depth",
        1,
      );
  }
  get broken(): number {
    const nothing: any = undefined;
    return nothing.value + this.#secret;
  }
  method(n: number): number {
    return n <= 0 ? this.broken : this.method(n - 1);
  }
  static make(depth: number): Thing { return new Thing({ depth }); }
}

export function thrower(kind: string): never {
  switch (kind) {
    case "plain": throw new Error("plain");
    case "type": { const f: any = 3; f(); }
    case "range": new Array(-1);
    default: throw new Boom(`kind ${kind}`, 2);
  }
}
