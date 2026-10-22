import { peek } from "../lenient/peek";

export class Holder {
  private hidden = 1;
  show(): number {
    return peek(this);
  }
}
