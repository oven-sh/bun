export class Modern {
  x = 1;
  constructor() {
    this.y = 2;
  }
}

export function Old() {
  this.x = 10;
  this.y = 20;
}
Old.prototype.sum = function () {
  return this.x + this.y;
};
