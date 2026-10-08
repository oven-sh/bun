type TestReturnType<T extends (...args: any[]) => any> = T extends (...args: any[]) => infer R ? R : any;

type Unpacked<T> =
  T extends (infer U)[] ? U :
  T extends (...args: any[]) => infer U ? U :
  T extends Promise<infer U> ? U :
  T;
