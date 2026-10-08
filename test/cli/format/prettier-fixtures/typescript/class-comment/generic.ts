class G1<T> implements IPoly<T> {
  x: T;
}

class G2 // g2
<T> implements IPoly<T> {
  x: T;
}

class G3 // g3
<T> extends U implements IPoly<T> {
  x: T;
}

class G4<T // g4
> extends U implements IPoly<T> {
  x: T;
}
