export interface Parsed { value: any; more?: any }
export function read(text: string): Parsed {
  return JSON.parse(text) as Parsed;
}
