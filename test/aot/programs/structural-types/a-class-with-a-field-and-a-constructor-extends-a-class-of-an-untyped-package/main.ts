/// <reference path="./types/legacy.d.ts" />
import { Widget } from "legacy";

class Wide extends Widget {
  extra = 1;
  constructor() {
    super();
  }
}
console.log(Object.keys(new Wide()).join());
