interface a {
  bar():any /* bat */;
}

type b = {
  bar():any /* bat */;
}

declare class c {
  bar():any /* bat */;
}

// https://github.com/babel/babel/blob/c92c4919771105140015167f25f7bacac77c90d9/scripts/babel-plugin-bit-decorator/types.d.ts#L28-L37
export type BitDecorator<T> = BitDecoratorCall<T> & {
  (assertMask: number): BitDecoratorCall<T>;

  storage(
    value: unknown,
    context: ClassFieldDecoratorContext<T, number>
  ): void /*{
    context.metadata.bitsStorage = context.access;
  }*/;
};
