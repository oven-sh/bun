-- config/pg_hba_auth.conf picks the method by role name. password_encryption decides the kind of verifier
-- when a password is set. SET it in this session: pg_reload_conf() is asynchronous.

CREATE USER bun_sql_test;

SET password_encryption = 'md5';
CREATE USER bun_sql_test_md5 PASSWORD 'bun_sql_test_md5';

SET password_encryption = 'scram-sha-256';
CREATE USER bun_sql_test_scram PASSWORD 'bun_sql_test_scram';
CREATE USER bun_sql_test_password PASSWORD 'bun_sql_test_password';

-- SASLprep maps the soft hyphen to nothing: the verifier is made from 'softhyphen'.
CREATE USER bun_sql_test_saslprep PASSWORD U&'soft\00ADhyphen';

-- Longer than the 64-byte block of HMAC-SHA-256.
CREATE USER bun_sql_test_long PASSWORD 'bun_sql_test_long_0123456789012345678901234567890123456789012345678901234567890123456789012345678901';

-- The password is 'bun_sql_test_scram_1000'. PostgreSQL 15 only makes verifiers with 4096 iterations, so this one is given.
CREATE USER bun_sql_test_scram_1000 PASSWORD 'SCRAM-SHA-256$1000:YnVuX3NxbF90ZXN0X3NhbHQ=$+aHGpn4LM5vEkQXqMwcu3zXk5hlB0AhhKUZPLiZewCw=:Efue7bImOUKSkP/wNe7E3sscZJPIJLuLaJib/N7kTss=';

CREATE DATABASE bun_sql_test OWNER bun_sql_test;
