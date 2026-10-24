import { log } from "./log";

log.push("bare ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "bare";

export default class Main {
  name = "bare";
}
