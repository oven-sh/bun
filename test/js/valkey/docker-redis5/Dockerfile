# Dockerfile for Redis 5 to test backward compatibility
FROM redis:5-alpine

# Set user to root
USER root

# Install bash for initialization scripts
RUN apk add --no-cache bash

# Create directories
RUN mkdir -p /etc/redis

# Copy configuration files
COPY redis5.conf /etc/redis/

# Expose port
EXPOSE 6379

# Use Redis 5 with custom config
CMD ["redis-server", "/etc/redis/redis5.conf"]