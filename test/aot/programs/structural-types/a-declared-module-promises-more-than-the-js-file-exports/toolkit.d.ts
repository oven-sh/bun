declare module "#toolkit" {
  export const limit: number;
  export const missingLimit: number;
  export const missingTitle: string;
  export const missingList: number[];
  export function twice(n: number): number;
  export function missingThrice(n: number): number;
  export class Gear {
    teeth: number;
    missingWear: number;
    constructor(teeth: number);
    missingTurn(): number;
    static missingMake(): Gear;
  }
  export class MissingWheel {
    spokes: number;
  }
}
