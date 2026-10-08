type A = { [key: string] };

type TwoParams = {
  [a: string, b: string]: string;
};
type ThreeParams = {
  [a: string, b: string, c: string]: string;
};

type TooLong = {
  [loooooooooooooooooooooooooong: string, looooooooooooooooooooooooooooooooooooooong: string]: string;
}
type TooLong81 = { [loooooooooooooooooooooooooong: string, loooooooooooooooooong: string]: string; }
type TooLong80 = { [loooooooooooooooooooooooooong: string, looooooooooooooooong: string]: string; }

// note lack of trailing comma in the index signature
type TooLongSingleParam = {
  [looooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong: string]: string;
}
