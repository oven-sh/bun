import { log } from "./log";

log.push("named-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "named-type";

export default class Main {
  name = "named-type";
}
