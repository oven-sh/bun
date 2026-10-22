export function Base(y = 2) {
  this.x = 1;
  this.y = y;
}

Base.prototype.sum = function () {
  return this.x + this.y;
};
