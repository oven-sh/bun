interface IObservable<T> {
  n: IObservable<T[]> // fails because of comment
}
