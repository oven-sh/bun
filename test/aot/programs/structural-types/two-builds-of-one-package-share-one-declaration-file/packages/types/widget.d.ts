export declare class Widget {
  width: number;
  height: number;
  constructor(width: number, height: number);
  area(): number;
  static count: number;
}
export declare function make(width: number, height: number): Widget;
export declare function isWidget(value: unknown): value is Widget;
