export const CONDITIONAL_AXIS_PROP_INDEX: Record<
  ConditionalAxisProp,
  {
    part: keyof AxisEncode;
    vgProp: VgEncodeChannel;
  } | null // null if we need to convert condition to signal
> = {
}
