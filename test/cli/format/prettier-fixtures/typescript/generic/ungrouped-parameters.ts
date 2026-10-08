function filterTooltipWithFoo<F extends Field>(oldEncoding: Encoding<F>): {
  customTooltipWithoutAggregatedField?:
    | StringFieldDefWithCondition<F>
    | StringValueDefWithCondition<F>
    | StringFieldDef<F>[];
  filteredEncoding: Encoding<F>;
} {
  const {tooltip, ...filteredEncoding} = oldEncoding;
  if (!tooltip) {
    return {filteredEncoding};
  }
  // ...
}
