declare module "gadgets" {
  export const count: number;
  export const label: string;
  export const sizes: number[];
  export const ready: boolean;
  export function half(n: number): number;
  export const settings: { depth: number; width: number };
  export class Lamp {
    watts: number;
    constructor(watts: number);
    brighter(): number;
  }
}
