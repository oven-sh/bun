import * as PropertySymbol from "./symbols";
export class Event {
  public [PropertySymbol.type]: string;
  public [PropertySymbol.target]: Event | null = null;
  private static [PropertySymbol.count]: number = 0;
  public [PropertySymbol.listeners]: Map<string, ((event: Event) => void) | null> = new Map();
  constructor(type: string) {
    this[PropertySymbol.type] = type;
    Event[PropertySymbol.count]++;
  }
  public get type(): string {
    return this[PropertySymbol.type];
  }
  public [PropertySymbol.count](by: number): number {
    return by + this[PropertySymbol.listeners].size;
  }
}
