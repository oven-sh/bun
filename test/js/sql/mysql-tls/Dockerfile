# Dockerfile
ARG MYSQL_VERSION=8.4
FROM mysql:${MYSQL_VERSION}

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
 && echo "require_secure_transport=ON" >> /etc/mysql/conf.d/force_tls.cnf

# Expose MySQL
EXPOSE 3306