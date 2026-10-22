class Pixel {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

export = Pixel;
