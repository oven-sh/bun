type templateLiteralType = `${
  TStringConvertedSoFar extends Capitalize<TStringConvertedSoFar>
    ? '_'
    : ''
}`;

type CamelToSnakeCase<TCamelCaseString extends string> =
  TCamelCaseString extends `${infer TStringConvertedSoFar}${infer TStringYetToConvert}`
    ? `${TStringConvertedSoFar extends Capitalize<TStringConvertedSoFar>
        ? '_'
        : ''}${Lowercase<TStringConvertedSoFar>}${CamelToSnakeCase<TStringYetToConvert>}`
    : TCamelCaseString;