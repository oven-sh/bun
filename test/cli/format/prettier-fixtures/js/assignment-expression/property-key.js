a = {
  [this.resource = resource]: 1,
}

class A {
  [this.resource = resource] = 1;

  [this.resource = resource]() {

  }
}
