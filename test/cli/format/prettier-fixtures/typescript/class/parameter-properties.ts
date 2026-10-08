class MyClass {
  constructor(protected x: number, private y: string) {
  }
}

[
  class {
    "constructor"(protected x: number, private y: string) {
    }
  },
]

class Mixed {
  constructor(public a: number, b: unknown) {
  }
}

class OneParameterProperty {
  constructor(public foobar: boolean) {
  }
}
