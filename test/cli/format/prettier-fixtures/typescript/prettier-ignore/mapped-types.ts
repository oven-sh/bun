type a= {
    // prettier-ignore
    [A in B]: C  |  D
  }

type b= {
    [
      // prettier-ignore
      A in B
    ]: C  |  D
  }

type c= {
    [
      A in
      // prettier-ignore
      B
    ]: C  |  D
  }

type d= {
    [A in B]:
      // prettier-ignore
      C  |  D
  }

type e= {
    [
      /* prettier-ignore */
      A in B
    ]: C  |  D
  }

type f= {
    [
      A in
      /* prettier-ignore */
      B
    ]: C  |  D
  }

type g= {
    [A in B]:
      /* prettier-ignore */
      C  |  D
  }


type h= {
    /* prettier-ignore */ [A in B]: C  |  D
  }

type i= {
    [/* prettier-ignore */ A in B ]: C  |  D
  }

type j= {
    [A in /* prettier-ignore */ B]: C  |  D
  }

type k= {
    [A in B]: /* prettier-ignore */ C  |  D
  }

type l= {
    /* prettier-ignore */
    [A in B]: C  |  D
  }
