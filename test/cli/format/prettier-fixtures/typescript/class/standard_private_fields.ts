class Square {
    #sideLength: number;
    readonly #area: number;
    #unit?: string;

    constructor(sideLength: number, unit?: string) {
        this.#sideLength = sideLength;
        this.#area = this.#sideLength ** 2;
        if (unit) {
          this.#unit = unit;
        }
    }

    equals(other: any) {
        return this.#sideLength === other.#sideLength;
    }

    getArea() {
      return this.#area + (this.#unit ?? 'px') + '²';
    }
}
