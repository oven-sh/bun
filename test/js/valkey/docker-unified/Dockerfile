# Unified Dockerfile for Valkey/Redis with TCP, TLS, Unix socket, and authentication support
FROM redis:8-alpine

# Set user to root
USER root

# Install bash for initialization scripts
RUN apk add --no-cache bash

# Create directories
RUN mkdir -p /etc/redis/certs
RUN mkdir -p /docker-entrypoint-initdb.d
RUN mkdir -p /data/appendonlydir && chown -R redis:redis /data

# Copy certificates
COPY server.key /etc/redis/certs/
COPY server.crt /etc/redis/certs/

# Copy configuration files
COPY redis.conf /etc/redis/
COPY users.acl /etc/redis/

# Copy initialization script
COPY scripts/init-redis.sh /docker-entrypoint-initdb.d/
RUN chmod +x /docker-entrypoint-initdb.d/init-redis.sh

# Expose ports
EXPOSE 6379 6380
WORKDIR /data

USER redis

# Use custom entrypoint to run initialization script
CMD ["redis-server", "/etc/redis/redis.conf"]