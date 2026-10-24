import { log } from "./log";

log.push("exported-again ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "exported-again";

export default class Main {
  name = "exported-again";
}
