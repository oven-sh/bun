ARG MYSQL_VERSION=8.4
FROM mysql:${MYSQL_VERSION}

# Bake a fully initialized data directory into the image so cold container
# start is just `exec mysqld` (~2-3s instead of ~60s); see
# test/docker/Dockerfile.mysql-plain for the rationale. This runs before the
# TLS config is copied in so the readiness poll can use plain TCP (the runtime
# config sets require_secure_transport=ON, which would reject it).
ENV MYSQL_ROOT_PASSWORD=bun \
    MYSQL_DATABASE=bun_sql_test \
    MYSQL_INITDB_SKIP_TZINFO=1

RUN set -e; \
    docker-entrypoint.sh mysqld --datadir=/var/lib/mysql-init & pid=$!; \
    for i in $(seq 180); do \
        mysql -h127.0.0.1 -uroot -pbun -e 'SELECT 1' >/dev/null 2>&1 && break; \
        sleep 1; \
    done; \
    mysql -h127.0.0.1 -uroot -pbun -e 'SELECT 1'; \
    mysqladmin -h127.0.0.1 -uroot -pbun shutdown; \
    wait "$pid"

# Copy TLS materials + config
# Expect these in the build context:
#   ssl/ca.pem
#   ssl/server-cert.pem
#   ssl/server-key.pem
#   conf.d/ssl.cnf
COPY ssl /etc/mysql/ssl
COPY conf.d /etc/mysql/conf.d

# Lock down permissions so mysqld accepts the key
# The official image runs mysqld as user "mysql"
RUN chown -R mysql:mysql /etc/mysql/ssl /etc/mysql/conf.d \
 && chmod 600 /etc/mysql/ssl/server-key.pem \
 && find /etc/mysql/ssl -type f -name "*.pem" -exec chmod 640 {} \; \
 && printf "[mysqld]\nrequire_secure_transport=ON\n" > /etc/mysql/conf.d/force_tls.cnf

CMD ["mysqld", "--datadir=/var/lib/mysql-init"]

# Expose MySQL
EXPOSE 3306
