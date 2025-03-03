# Dockerfile
FROM postgres:15

# Create initialization script
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Wait for PostgreSQL to start\n\
until pg_isready; do\n\
  echo "Waiting for PostgreSQL to start..."\n\
  sleep 1\n\
done\n\
\n\
dropdb --if-exists bun_sql_test\n\
\n\
# Drop and recreate users with different auth methods\n\
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL\n\
    DROP USER IF EXISTS bun_sql_test;\n\
    CREATE USER bun_sql_test;\n\
    \n\
    ALTER SYSTEM SET password_encryption = '"'"'md5'"'"';\n\
    SELECT pg_reload_conf();\n\
    DROP USER IF EXISTS bun_sql_test_md5;\n\
    CREATE USER bun_sql_test_md5 WITH PASSWORD '"'"'bun_sql_test_md5'"'"';\n\
    \n\
    ALTER SYSTEM SET password_encryption = '"'"'scram-sha-256'"'"';\n\
    SELECT pg_reload_conf();\n\
    DROP USER IF EXISTS bun_sql_test_scram;\n\
    CREATE USER bun_sql_test_scram WITH PASSWORD '"'"'bun_sql_test_scram'"'"';\n\
EOSQL\n\
\n\
# Create database and set permissions\n\
createdb bun_sql_test\n\
\n\
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL\n\
    GRANT ALL ON DATABASE bun_sql_test TO bun_sql_test;\n\
    ALTER DATABASE bun_sql_test OWNER TO bun_sql_test;\n\
EOSQL\n\
' > /docker-entrypoint-initdb.d/init-users-db.sh

# Make the script executable
RUN chmod +x /docker-entrypoint-initdb.d/init-users-db.sh

# Create pg_hba.conf
RUN mkdir -p /etc/postgresql && touch /etc/postgresql/pg_hba.conf && \
    echo "local all postgres trust" >> /etc/postgresql/pg_hba.conf && \
    echo "local all bun_sql_test trust" >> /etc/postgresql/pg_hba.conf && \
    echo "local all bun_sql_test_md5 md5" >> /etc/postgresql/pg_hba.conf && \
    echo "local all bun_sql_test_scram scram-sha-256" >> /etc/postgresql/pg_hba.conf && \
    echo "host all postgres 127.0.0.1/32 trust" >> /etc/postgresql/pg_hba.conf && \
    echo "host all bun_sql_test 127.0.0.1/32 trust" >> /etc/postgresql/pg_hba.conf && \
    echo "host all bun_sql_test_md5 127.0.0.1/32 md5" >> /etc/postgresql/pg_hba.conf && \
    echo "host all bun_sql_test_scram 127.0.0.1/32 scram-sha-256" >> /etc/postgresql/pg_hba.conf && \
    echo "host all postgres ::1/128 trust" >> /etc/postgresql/pg_hba.conf && \
    echo "host all bun_sql_test ::1/128 trust" >> /etc/postgresql/pg_hba.conf && \
    echo "host all bun_sql_test_md5 ::1/128 md5" >> /etc/postgresql/pg_hba.conf && \
    echo "host all bun_sql_test_scram ::1/128 scram-sha-256" >> /etc/postgresql/pg_hba.conf && \
    echo "local replication all trust" >> /etc/postgresql/pg_hba.conf && \
    echo "host replication all 127.0.0.1/32 trust" >> /etc/postgresql/pg_hba.conf && \
    echo "host replication all ::1/128 trust" >> /etc/postgresql/pg_hba.conf
RUN mkdir -p /docker-entrypoint-initdb.d && \
    echo "ALTER SYSTEM SET max_prepared_transactions = '1000';ALTER SYSTEM SET max_connections = '2000';" > /docker-entrypoint-initdb.d/configure-postgres.sql
# Set environment variables
ENV POSTGRES_HOST_AUTH_METHOD=trust
ENV POSTGRES_USER=postgres

# Expose PostgreSQL port
EXPOSE 5432