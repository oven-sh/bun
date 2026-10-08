interface A1  // comment
{  foo(): bar;}

interface A2  // comment
extends Base
{  foo(): bar;}

interface A3  // comment1
extends Base  // comment2
{  foo(): bar;}

interface A4  // comment1
extends Base  // comment2
              // comment3
{  foo(): bar;}

interface A5  // comment1
extends Base  // comment2
              // comment3
{             // comment4
foo(): bar;}

interface A6  // comment1
extends Base  // comment2
              // comment3
{
// comment4
foo(): bar;}
