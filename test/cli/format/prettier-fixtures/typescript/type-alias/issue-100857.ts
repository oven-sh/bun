type FieldLayoutWith<
  T extends string,
  S extends unknown = { width: string }
> = {
  type: T;
  code: string;
  size: S;
};

type FieldLayoutWith<
  T extends string,
  S extends unknown,
> = {
  type: T;
  code: string;
  size: S;
};

type FieldLayoutWith<
  S extends unknown = { width: string }
> = {
  type: T;
  code: string;
  size: S;
};

type FieldLayoutWith<
  T extends stringggggggggggg,
  T extends stringggggggggggg
> = {
  type: T;
  code: string;
  size: S;
};

type FieldLayoutWith<
  T extends stringggggggggggg,
  S = stringggggggggggggggggg
> = {
  type: T;
  code: string;
  size: S;
};
