export function mergeWith(object: any, ...sourcesAndCustomizer: any[]): any;
export function assignAll(object: any, source: any): any;
export function set(object: any, key: PropertyKey, value: unknown): any;
export function makeTheirs(i: number): any;
export class Theirs {
  a: number;
  b?: string;
  nested: any;
  constructor(i: number);
}
export const copiers: Record<string, (object: any) => any>;
