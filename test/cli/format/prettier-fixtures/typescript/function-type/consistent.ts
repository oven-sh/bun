// TSFunctionType
type A = (
  tpl: TemplateStringsArray,
  ...args: Array<unknown>
) => (replacements?: PublicReplacements) => T;

// TSConstructorType
type B = new (
  tpl: TemplateStringsArray,
  ...args: Array<unknown>
) => (replacements?: PublicReplacements) => T;

type X = {
  // TSCallSignatureDeclaration
  (
    tpl: TemplateStringsArray,
    ...args: Array<unknown>
  ): (replacements?: PublicReplacements) => T;

  // TSConstructSignatureDeclaration
  new (
    tpl: TemplateStringsArray,
    ...args: Array<unknown>
  ): (replacements?: PublicReplacements) => T;
};
