export interface MarkDef<
  M extends string | Mark = Mark,
  ES extends ExprRef | SignalRef = ExprRef | SignalRef
> extends
    A,
    B,
    C {}

declare class MarkDef<
  M extends string | Mark = Mark,
  ES extends ExprRef | SignalRef = ExprRef | SignalRef
> implements
    A,
    B,
    C {}
