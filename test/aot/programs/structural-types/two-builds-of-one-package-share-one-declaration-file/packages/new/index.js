export class Widget {
  #area;
  static count = "many";
  constructor(width, height) {
    this.height = height;
    this.width = width;
    this.#area = width * height;
  }
  area() {
    return this.#area;
  }
}

export function make(width, height) {
  return new Widget(width, height);
}

export function isWidget(value) {
  return value instanceof Widget;
}
