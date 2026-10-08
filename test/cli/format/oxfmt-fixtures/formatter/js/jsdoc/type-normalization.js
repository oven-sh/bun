/**
 * @param {  string  |  number  } x - The value
 */
function a(x) {}

/**
 * @returns {  Array< string >  } The list
 */
function b() {}

/**
 * @type {  boolean  }
 */
const c = true;

/**
 * @param {"'" | '"' | '`'} quote
 */
function quoteTypes(quote) {}

/** @type {ProxyHandler<{ props: Record<string, unknown> }>} */
let handler;

/** @type {ProxyHandler<{ props: Record<string, unknown>; handler: (event: CustomEvent<string>) => void }>} */
let handler2;

/**
 * @param {AST.Fragment['nodes']} nodes
 */
function getNodes(nodes) {}

/**
 * @param {Binding['kind']} kind
 */
function getKind(kind) {}

/**
 * @param {'foo' | 'bar'} value - String literal union
 */
function stringLiterals(value) {}

/**
 * @returns {string | number | null}
 */
function getValueOrNull() {}

/**
 * @returns {null | Element}
 */
function findElement() {}

/**
 * @param {string | number | boolean | null | undefined} value - Many types
 */
function manyTypes(value) {}

class Foo {
  /**
   * @returns {AST.RegularElement | AST.SvelteElement | AST.SvelteWindow | AST.SvelteDocument | AST.SvelteBody | AST.SvelteHead}
   */
  method1() {}

  /**
   * @returns {null | Element}
   */
  method2() {}

  /**
   * @param {null | Element | Text | Comment} node - The target node
   */
  method3(node) {}

  /**
   * @returns {SomeConfigValue | AnotherConfigValue | YetAnotherConfigVal | null}
   */
  borderlineUnion() {}
}

function outer() {
  function inner() {
    /**
     * @returns {Map<Element, CssNode[]> | null}
     */
    function deeplyNested() {}

    /**
     * @returns {AST.Css.Rule | AST.Css.Atrule | null} The matching node
     */
    function withDescription() {}
  }
}
