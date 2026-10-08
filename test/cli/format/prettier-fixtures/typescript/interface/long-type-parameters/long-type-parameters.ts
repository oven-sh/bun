// https://github.com/vega/vega-lite/blob/ae13aff7b480cf9c994031eca08a6b1720e01ab3/src/mark.ts#L602
export interface MarkDef<
  M extends string | Mark = Mark,
  ES extends ExprRef | SignalRef = ExprRef | SignalRef
> extends GenericMarkDef<M>,
    Omit<
      MarkConfig<ES> &
        AreaConfig<ES> &
        BarConfig<ES> & // always extends RectConfig
        LineConfig<ES> &
        TickConfig<ES>,
      'startAngle' | 'endAngle' | 'width' | 'height'
    >,
    MarkDefMixins<ES> {}
