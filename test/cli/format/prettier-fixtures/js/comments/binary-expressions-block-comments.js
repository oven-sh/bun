a = b || /** Comment */
c;

a = b /** Comment */ ||
c;

a = b || /** TODO this is a very very very very long comment that makes it go > 80 columns */
c;

a = b /** TODO this is a very very very very long comment that makes it go > 80 columns */ ||
c;

a = b || /** TODO this is a very very very very long comment that makes it go > 80 columns */ c;

a = b && /** Comment */
c;

a = b /** Comment */ &&
c;

a = b && /** TODO this is a very very very very long comment that makes it go > 80 columns */
c;

a = b /** TODO this is a very very very very long comment that makes it go > 80 columns */ &&
c;

a = b && /** TODO this is a very very very very long comment that makes it go > 80 columns */ c;

a = b + /** Comment */
c;

a = b /** Comment */ +
c;

a = b + /** TODO this is a very very very very long comment that makes it go > 80 columns */
c;

a = b /** TODO this is a very very very very long comment that makes it go > 80 columns */ +
c;

a = b + /** TODO this is a very very very very long comment that makes it go > 80 columns */ c;