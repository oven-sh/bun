type A1 = /* 4 */ (
  | A
  | B
)[]

type A2 = // dir, exp, arg, modifiers
  | [string]
  | [string, ExpressionNode]
  | [string, ExpressionNode, ExpressionNode]
  | [string, ExpressionNode, ExpressionNode, ObjectExpression]

type A3 = // dir, exp, arg, modifiers
  & [string]
  & [string, ExpressionNode]
  & [string, ExpressionNode, ExpressionNode]
  & [string, ExpressionNode, ExpressionNode, ObjectExpression]

type SuperLongTypeNameLoremIpsumLoremIpsumBlaBlaBlaBlaBlaBlaBlaBlaBlaBlaBlaBla =
  Fooo1000 | Baz2000 | BarLoooooooooooooooooooooooooooooooooooooooooooooooooLong;

type SuperLongTypeNameLoremIpsumLoremIpsumBlaBlaBlaBlaBlaBlaBlaBlaBlaBlaBlaBl2 =
  Fooo1000 & Baz2000 & BarLoooooooooooooooooooooooooooooooooooooooooooooooooLong;
