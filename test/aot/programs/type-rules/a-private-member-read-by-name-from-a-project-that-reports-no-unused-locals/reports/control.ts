import { peekControl } from "./peek-control";

export class Control {
  private hidden = 2;
  show(): number {
    return peekControl(this);
  }
}
