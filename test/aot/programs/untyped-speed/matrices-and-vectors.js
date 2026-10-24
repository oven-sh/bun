// Floating-point arithmetic: matrices of 12 by 12 as arrays of arrays, multiplied and transposed, and short-lived vectors of three components from an ES5 constructor.
function zeros(rows, columns) {
  var matrix = [];
  for (var i = 0; i < rows; i++) {
    var row = [];
    for (var j = 0; j < columns; j++) row.push(0);
    matrix.push(row);
  }
  return matrix;
}

function multiply(a, b) {
  var rows = a.length;
  var inner = b.length;
  var columns = b[0].length;
  var out = zeros(rows, columns);
  for (var i = 0; i < rows; i++) {
    var rowOfA = a[i];
    var rowOfOut = out[i];
    for (var k = 0; k < inner; k++) {
      var factor = rowOfA[k];
      var rowOfB = b[k];
      for (var j = 0; j < columns; j++) rowOfOut[j] += factor * rowOfB[j];
    }
  }
  return out;
}

function transpose(matrix) {
  return matrix[0].map(function (_, column) {
    return matrix.map(function (row) {
      return row[column];
    });
  });
}

function Vector(x, y, z) {
  this.x = x;
  this.y = y;
  this.z = z;
}
Vector.prototype.add = function (other) {
  return new Vector(this.x + other.x, this.y + other.y, this.z + other.z);
};
Vector.prototype.scale = function (factor) {
  return new Vector(this.x * factor, this.y * factor, this.z * factor);
};
Vector.prototype.dot = function (other) {
  return this.x * other.x + this.y * other.y + this.z * other.z;
};
Vector.prototype.cross = function (other) {
  return new Vector(this.y * other.z - this.z * other.y, this.z * other.x - this.x * other.z, this.x * other.y - this.y * other.x);
};
Vector.prototype.length = function () {
  return Math.sqrt(this.dot(this));
};

function trace(matrix) {
  var sum = 0;
  for (var i = 0; i < matrix.length; i++) sum += matrix[i][i];
  return sum;
}

function run(rounds) {
  var size = 12;
  var a = zeros(size, size);
  var b = zeros(size, size);
  for (var i = 0; i < size; i++) {
    for (var j = 0; j < size; j++) {
      a[i][j] = ((i * 7 + j * 3) % 11) / 4;
      b[i][j] = ((i + j * 5) % 13) - 6;
    }
  }
  var total = 0;
  var position = new Vector(0, 0, 0);
  var velocity = new Vector(1, 0.5, -0.25);
  var axis = new Vector(0, 0, 1);
  for (var round = 0; round < rounds; round++) {
    total += trace(multiply(a, transpose(b))) % 97;
    for (var step = 0; step < 200; step++) {
      velocity = velocity.add(velocity.cross(axis).scale(0.01));
      position = position.add(velocity.scale(0.1));
    }
    total += Math.floor(position.length()) % 31;
  }
  return Math.round(total * 100) / 100;
}

console.log(run(4000));
