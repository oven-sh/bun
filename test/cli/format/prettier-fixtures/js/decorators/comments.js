var x = 100

@Hello({
  a: 'a', // Comment is in the wrong place
  // test
  b: '2'
})
class X {

}


@NgModule({
  // Imports.
  imports: [
    // Angular modules.
    BrowserModule,

    // App modules.
    CoreModule,
    SharedModule,
  ],
})
export class AppModule {}

// A
@Foo()
// B
@Bar()
// C
export class Bar{}

class Something {
    @Annotateme()
    property;
}
