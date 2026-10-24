import { log } from "./log";

log.push("namespace-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "namespace-type";

export default class Main {
  name = "namespace-type";
}
