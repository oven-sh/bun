export type OuterType1<
  LongerLongerLongerLongerInnerType extends LongerLongerLongerLongerOtherType<OneMoreType>
> = { a: 1 };
export type OuterType12<
  LongerLongerLongerLongerInnerType = LongerLongerLongerLongerOtherType<OneMoreType>
> = { a: 1 };

export type OuterType2<
  LongerLongerLongerLongerInnerType extends LongerLongerLongerLongerLongerLongerLongerLongerOtherType
> = { a: 1 };
export type OuterType22<
  LongerLongerLongerLongerInnerType = LongerLongerLongerLongerLongerLongerLongerLongerOtherType
> = { a: 1 };

export type OuterType3<
  LongerLongerLongerLongerInnerType extends LongerLongerLongerLongerLongerLo.ngerLongerLongerOtherType
> = { a: 1 };
export type OuterType32<
  LongerLongerLongerLongerInnerType = LongerLongerLongerLongerLongerLo.ngerLongerLongerOtherType
> = { a: 1 };

export type OuterType4<
  LongerLongerLongerLongerInnerType extends
    | LongerLongerLongerLongerLongerLo
    | ngerLongerLongerOtherType
> = { a: 1 };
export type OuterType42<
  LongerLongerLongerLongerInnerType =
    | LongerLongerLongerLongerLongerLo
    | ngerLongerLongerOtherType
> = { a: 1 };
