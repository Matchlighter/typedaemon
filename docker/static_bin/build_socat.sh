#!/bin/bash

set -e
set -o pipefail
set -x

SOCAT_VERSION=1.8.0.2
NCURSES_VERSION=6.5
READLINE_VERSION=8.2
OPENSSL_VERSION=3.4.0

function build_ncurses() {
    cd /build

    # Download
    curl -LO http://invisible-mirror.net/archives/ncurses/ncurses-${NCURSES_VERSION}.tar.gz
    tar zxvf ncurses-${NCURSES_VERSION}.tar.gz
    cd ncurses-${NCURSES_VERSION}

    # Build
    CC='/usr/bin/gcc -static' CFLAGS='-fPIC' ./configure \
        --disable-shared \
        --enable-static
}

function build_readline() {
    cd /build

    # Download
    # curl -LO ftp://ftp.cwru.edu/pub/bash/readline-${READLINE_VERSION}.tar.gz
    curl -LO ftp://ftp.gnu.org/gnu/readline/readline-${READLINE_VERSION}.tar.gz
    tar xzvf readline-${READLINE_VERSION}.tar.gz
    cd readline-${READLINE_VERSION}

    # Build
    CC='/usr/bin/gcc -static' CFLAGS='-fPIC' ./configure \
        --disable-shared \
        --enable-static
    make -j4

    # Note that socat looks for readline in <readline/readline.h>, so we need
    # that directory to exist.
    ln -s /build/readline-${READLINE_VERSION} /build/readline
}

function build_openssl() {
    cd /build

    # Download
    curl -LO https://www.openssl.org/source/openssl-${OPENSSL_VERSION}.tar.gz
    tar zxvf openssl-${OPENSSL_VERSION}.tar.gz
    cd openssl-${OPENSSL_VERSION}

    # Configure
    CC='/usr/bin/gcc -static' ./Configure no-shared no-async linux-$(uname -m)

    # Build
    make -j4
    echo "** Finished building OpenSSL"
}

function build_socat() {
    cd /build

    # Download
    curl -LO http://www.dest-unreach.org/socat/download/socat-${SOCAT_VERSION}.tar.gz
    tar xzvf socat-${SOCAT_VERSION}.tar.gz
    cd socat-${SOCAT_VERSION}

    # Build
    # NOTE: `NETDB_INTERNAL` is non-POSIX, and thus not defined by MUSL.
    # We define it this way manually.
    CC='/usr/bin/gcc -static' \
        CFLAGS='-fPIC' \
        CPPFLAGS="-I/build -I/build/openssl-${OPENSSL_VERSION}/include -DNETDB_INTERNAL=-1" \
        LDFLAGS="-L/build/readline-${READLINE_VERSION} -L/build/ncurses-${NCURSES_VERSION}/lib -L/build/openssl-${OPENSSL_VERSION}" \
        ./configure --disable-shared --enable-static
    make -j4
    strip socat
}

function doit() {
    build_ncurses
    build_readline
    # build_openssl
    build_socat

    mkdir -p /output/

    cp /build/socat-${SOCAT_VERSION}/socat /output/
    echo "** Finished **"
}

doit
