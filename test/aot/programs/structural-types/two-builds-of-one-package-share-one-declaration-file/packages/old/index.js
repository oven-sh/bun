export function Widget(width, height) {
  this.width = width;
  this.height = height;
  Widget.count++;
}
Widget.count = 0;
Widget.prototype.area = function () {
  return this.width * this.height;
};

export function make(width, height) {
  return new Widget(width, height);
}

export function isWidget(value) {
  return value instanceof Widget;
}
