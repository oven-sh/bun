import type { Input } from "./types";
const half = (text: string): string => text;
export function compose(input: Input, names: string[]): string {
  let literal = "";
  const inner = names as readonly string[];
  literal += `
	const {` + `app,` +
    // @ts-ignore
    half(`${inner.length as number}`, 2) + `
	} = input
  `;
  type Local = Input;
  const kept: Local = input;
  return literal + `
` + Object.keys(kept).length;
}
