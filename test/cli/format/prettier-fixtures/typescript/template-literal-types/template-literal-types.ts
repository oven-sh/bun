let x: `foo-${infer bar}`;
type HelloWorld = `${Hello}, ${World}`
type SeussFish = `${Quantity | Color} fish`;
declare function setAlignment(value: `${VerticalAlignment}-${HorizontalAlignment}`): void;
type PropEventSource<T> = {
  on(eventName: `${string & keyof T}Changed`, callback: () => void): void;
};
type PropEventSource<T> = {
  on<K extends string & keyof T>
    (eventName: `${K}Changed`, callback: (newValue: T[K]) => void ): void;
};
