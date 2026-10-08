declare module "classnames" {
  export default function classnames(...inputs: (string | number | false | object | undefined)[]): string;
  export class x {}
  export interface y {}
  export type z = y;
}

declare module "x" {
  export default class x {}
}

declare module "y" {
  const y = 5;
  export default y;
}
