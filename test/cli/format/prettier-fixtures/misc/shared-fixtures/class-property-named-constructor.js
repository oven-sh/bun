import { outdent } from "outdent";

const testCases = [
  outdent`
    class Foo {
      constructor
    }
  `,
  outdent`
    class Foo {
      'construct\u{6f}r'
    }
  `,
  outdent`
    class Foo {
      'constructor'
    }
  `,
  outdent`
    class Foo {
      accessor 'construct\u{6f}r'
    }
  `,
  outdent`
    class Foo {
      accessor 'constructor'
    }
  `,
  outdent`
    class Foo {
      accessor constructor
    }
  `,
];

export { testCases };
