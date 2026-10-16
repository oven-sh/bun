import * as PropertySymbol from "./symbols";
export class Event {
  public [PropertySymbol.target]: Event | null = null;
  public get target(): Event {
    return <Event>this[PropertySymbol.target];
  }
  public get sure(): Event {
    return this[PropertySymbol.target]!;
  }
  public get other(): Event {
    return this[PropertySymbol.target] as Event;
  }
}
