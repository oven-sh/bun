// https://github.com/tc39/proposal-private-fields-in-in

class C {
  #brand;

  static isC(obj) {
    try {
      obj.#brand;
      return true;
    } catch {
      return false;
    }
  }
}

class C2 {
  #data = null; // populated later

  get #getter() {
    if (!this.#data) {
      throw new Error('no data yet!');
    }
    return this.#data;
  }

  static isC(obj) {
    try {
      obj.#getter;
      return true;
    } catch {
      return false; // oops! might have gotten here because `#getter` threw :-(
    }
  }
}

class C3 {
  #brand;

  #method() {}

  get #getter() {}

  static isC(obj) {
    return #brand in obj && #method in obj && #getter in obj;
  }
}

// Invalid https://github.com/tc39/proposal-private-fields-in-in#try-statement
// class C {
//   #brand;

//   static isC(obj) {
//     return try obj.#brand;
//   }
// }
