<style jsx>{`
  p {
    color: red;
  }
`}</style>;

<style jsx>{tpl`
  p {
    color: red;
  }
`}</style>;

<style jsx>
  {`p {
     color: red;
     }
  `}
</style>;

// #5886
<style jsx>{`
  .class {
    flex-direction: column${long_cond && long_cond && long_cond
        ? "-reverse"
        : ""};
  }
`}</style>;
<style jsx>{`
  .class {
    flex-direction: column${long_cond && long_cond && long_cond? "-reverse": ""};
  }
`}</style>;
