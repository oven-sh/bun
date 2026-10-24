import * as library from "./library.ts";

declare module "./library.ts" {
  const added: number;
  let addedTitle: string;
  function addedThrice(n: number): number;
  namespace Shapes {
    const corners: number;
  }
  namespace Mode {
    function parse(text: string): Mode;
  }
}

export function addedPlusOne(): number {
  return library.added + 1;
}
