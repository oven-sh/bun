<style jsx>{`
  div {
  display: ${expr};
    color: ${expr};
    ${expr};
    ${expr};
    background: red;
  animation: ${expr} 10s ease-out;
  }
  @media (${expr}) {
   div.${expr} {
    color: red;
   }
  ${expr} {
    color: red;
  }
  }
  @media (min-width: ${expr}) {
   div.${expr} {
    color: red;
   }
  all${expr} {
    color: red;
  }
  }
  @font-face {
    ${expr}
  }
`}</style>;

<style jsx>{`
  div {
  animation: linear ${seconds}s ease-out;
  }
`}</style>;

<style jsx>{`
  div {
  animation: 3s ease-in 1s ${foo => foo.getIterations()} reverse both paused slidein;
  }
`}</style>;
