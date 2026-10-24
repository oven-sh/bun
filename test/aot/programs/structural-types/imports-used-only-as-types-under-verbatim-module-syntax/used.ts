import { log } from "./log";

log.push("used ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "used";

export default class Main {
  name = "used";
}
