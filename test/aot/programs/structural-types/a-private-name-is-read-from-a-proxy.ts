class Safe {
  #code = 42;
  static codeOf(safe: Safe): number {
    return safe.#code;
  }
}

const proxied: Safe = new Proxy(new Safe(), {});
console.log(Safe.codeOf(new Safe()));
try {
  console.log(Safe.codeOf(proxied));
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(proxied instanceof Safe);

export {};
