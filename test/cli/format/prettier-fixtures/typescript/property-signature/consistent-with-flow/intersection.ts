export interface DirectiveArgumentNode extends ArrayExpression {
  elements: // dir, exp, arg, modifiers
    & [string]
    & [string, ExpressionNode]
    & [string, ExpressionNode, ExpressionNode]
    & [string, ExpressionNode, ExpressionNode, ObjectExpression]
}
