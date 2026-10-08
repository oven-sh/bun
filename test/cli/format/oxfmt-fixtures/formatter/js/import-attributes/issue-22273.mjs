// Issue #22273 - Should have a space after commas in import attributes
import myEmbeddedDb from './my.db' with { type: 'sqlite', embed: 'true' }
import myEmbeddedDb2 from './my.db' with {type: 'sqlite',embed: 'true'}
import myEmbeddedDb3 from './my.db' with { embed: 'true', type: 'sqlite' }

// Should be spread over multiple lines
import myEmbeddedDb4 from './my.db' with { type: 'sqlite', embed: 'true', veryLongAttribute: 'true' }
import myEmbeddedDb5 from './my.db' with { veryVeryVeryVeryVeryVeryVeryVeryVeryLongAttribute: 'true' }
