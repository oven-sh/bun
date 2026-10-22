import { log } from "./log";

log.push("inline-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "inline-type";

export default class Main {
  name = "inline-type";
}
