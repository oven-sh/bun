import { log } from "./log";

log.push("default-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "default-type";

export default class Main {
  name = "default-type";
}
