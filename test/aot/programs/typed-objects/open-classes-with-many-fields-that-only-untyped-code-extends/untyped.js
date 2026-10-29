import { Six, Fifty, Seventy } from "./core.ts";
export class HeirOfSix extends Six {
  constructor(seed) {
    super(seed);
    this.own = seed + 1;
    this.other = "x";
  }
}
export class HeirOfFifty extends Fifty {
  constructor(seed) {
    super(seed);
    this.own = seed + 1;
  }
}
export class HeirOfSeventy extends Seventy {
  constructor(seed) {
    super(seed);
    this.own = seed + 1;
  }
}
export class HeirOfTheHeir extends HeirOfFifty {
  constructor(seed) {
    super(seed);
    this.last = seed + 2;
  }
}
