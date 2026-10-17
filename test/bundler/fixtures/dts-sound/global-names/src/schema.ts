export class Generator {
  next = 0;
  take(): number {
    return this.next++;
  }
}
