// @bun
var i,c=0;
function foo()
{
    var a=1,b;for(i=0;i<2;++i){[a,b]=[b,a];c++}if(!a^b)throw c
}
noInline(foo);
for(var k = 0; k < testLoopCount; ++k)
    foo()
