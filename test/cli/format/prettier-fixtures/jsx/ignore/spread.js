// #8736

function HelloWorld() {
  return (
    <div
      {...{} /*
      // @ts-ignore */ /* prettier-ignore */}
      invalidProp="HelloWorld"
    >
      test
    </div>
  );
}

a = <div {.../* prettier-ignore */b}/>
a = <div {...b/* prettier-ignore */}/>
a = <div {.../* prettier-ignore */{}}/>
a = <div {...{/* prettier-ignore */}}/>
a = <div {...{}/* prettier-ignore */}/>
