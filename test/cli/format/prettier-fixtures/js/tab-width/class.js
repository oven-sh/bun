class A {
  method() {
    var x = 1;
    while(typeof x == "number" || typeof x == "string") {
        x = x + 1;
        if (true) x = "";
    }
    var z = x;
  }
}
