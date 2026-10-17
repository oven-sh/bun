type Parsed = string | number;

const isHex = /^0x[0-9a-f]+$/i;
const isDecimal = /^\d+$/;
const coerce = (text: string): Parsed => (isHex.test(text) || isDecimal.test(text) ? Number(text) : text);

export interface Options {
  fallback?: Parsed;
}

export const parse = (text: string, options: Options = {}): Parsed => {
  const found: Parsed = coerce(text);
  return text === "" ? (options.fallback ?? found) : found;
};
