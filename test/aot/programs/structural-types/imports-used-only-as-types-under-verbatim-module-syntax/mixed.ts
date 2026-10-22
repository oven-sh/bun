import { log } from "./log";

log.push("mixed ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "mixed";

export default class Main {
  name = "mixed";
}
