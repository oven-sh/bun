import { log } from "./log";

log.push("whole-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "whole-type";

export default class Main {
  name = "whole-type";
}
