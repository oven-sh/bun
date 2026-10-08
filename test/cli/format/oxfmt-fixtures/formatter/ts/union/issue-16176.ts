export default class TestUnionTypeAnnotation1 {
  private prop!: /* comment */
    LongLongLongLongLongLongType[] | LongLongLongLongLongLongType[];

  private accessor prop2!: /* comment */
    LongLongLongLongLongLongType[] | LongLongLongLongLongLongType[];
}

export interface TestUnionTypeAnnotation2 {
  property: /* comment */
    LongLongLongLongLongLongType[] | LongLongLongLongLongLongType[];
}
