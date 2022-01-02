
# This builds the specifc version of Zig used by Bun
# It outputs a zig.zip file
FROM ubuntu:20.04

RUN apt-get update && apt-get install --no-install-recommends -y wget gnupg2 curl lsb-release wget software-properties-common
RUN curl -s https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -

RUN wget https://apt.llvm.org/llvm.sh --no-check-certificate
RUN chmod +x llvm.sh
RUN ./llvm.sh 13

RUN apt-get update && apt-get install --no-install-recommends -y \
    ca-certificates \
    curl \
    gnupg2 \
    software-properties-common \
    cmake \
    build-essential \
    git \
    libssl-dev \
    liblld-13-dev \
    libclang-13-dev \
    gcc \
    g++ \
    clang-13 \
    clang-format-13 \
    libc++-13-dev \
    libc++abi-13-dev \
    lld-13 \
    zip

RUN update-alternatives --install /usr/bin/ld ld /usr/bin/lld-13 90 && \
    update-alternatives --install /usr/bin/cc cc /usr/bin/clang-13 90 && \
    update-alternatives --install /usr/bin/cpp cpp /usr/bin/clang++-13 90 && \
    update-alternatives --install /usr/bin/c++ c++ /usr/bin/clang++-13 90


ENV CC=clang-13 
ENV CXX=clang++-13

RUN mkdir /output;
WORKDIR /output
ARG TAG "jan1"

# Compile zig
RUN --mount=type=tmpfs,target=/zig-build \
    cd /zig-build && \
    mkdir -p /zig-build; \
    git clone https://github.com/jarred-sumner/zig.git --depth=1; \
    cd /zig-build/zig; \
    cmake . -DCMAKE_BUILD_TYPE=Release && \
    make -j$(nproc) && \
    rm -rf .git; \
    cd /zig-build; \
    zip -r zig.zip zig; \
    echo "${TAG}" > /output/.zig-version; \
    cp zig.zip /output;



