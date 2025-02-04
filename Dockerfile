# ======= Static Binaries ======= #
FROM alpine:3.20.2 AS static_bin

RUN apk --update add build-base bash automake git curl linux-headers openssl-dev

RUN mkdir /build
ADD docker/static_bin /build

RUN /build/build_socat.sh

# ======= TD Package Builder ======= #
FROM node:18 AS builder

ARG BUILD_VERSION
ARG BUILD_CHANNEL

WORKDIR /opt/typedaemon_build

RUN apt-get update && apt-get install -y jq

# Install Deps
COPY package.json yarn.lock ./
COPY patches patches
RUN yarn install --frozen-lockfile --network-timeout 1000000

# Add App
COPY tsconfig.json ./
COPY src/ ./src/
COPY script/ ./script/
RUN yarn build

# Remove Dev Dependencies
# RUN yarn install --production --frozen-lockfile

# Copy in non-compiled files
COPY . .
COPY ./docker/skel ./skel

# Add version info
RUN \
    echo '{ "version": "'${BUILD_VERSION}'", "channel": "'${BUILD_CHANNEL}'" }' > version.json \
    && jq '.image_version = "'${BUILD_VERSION}'" | .image_channel = "'${BUILD_CHANNEL}'"' package.json > /tmp/package.json && mv /tmp/package.json package.json

# Remove src
RUN rm -rf src/ node_modules/ docker/

WORKDIR /opt/typedaemon

COPY yarn.lock ./
COPY ./docker/package.json .
RUN yarn install --production --pure-lockfile
RUN yarn patch-package --patch-dir node_modules/typedaemon/patches/


# ======= TD Runtime ======= #
FROM node:18

ARG TARGETARCH
ARG TARGETVARIANT

ARG S6_OVERLAY_VERSION="3.1.5.0"

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y locales && \
    sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && \
    dpkg-reconfigure --frontend=noninteractive locales && \
    update-locale LANG=en_US.UTF-8 && \
    apt-get clean && \
    rm -fr /tmp/* /var/{cache,log}/* /var/lib/apt/lists/*

ENV LANG en_US.UTF-8 

RUN \
    apt-get update \
    \
    && apt-get install -y --no-install-recommends \
        bash \
        socat \
        ssh \
        ca-certificates \
        curl \
        jq \
        tzdata \
        xz-utils \
    \
    && c_rehash \
    \
    && S6_ARCH="${TARGETARCH}" \
    && if [ "${TARGETARCH}" = "i386" ]; then S6_ARCH="i686"; \
    elif [ "${TARGETARCH}" = "amd64" ]; then S6_ARCH="x86_64"; \
    elif [ "${TARGETARCH}" = "armv7" ]; then S6_ARCH="arm"; \
    elif [ "${TARGETARCH}" = "arm64" ]; then S6_ARCH="arm"; fi \
    \
    && curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" \
        | tar -C / -Jxpf - \
    \
    && curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" \
        | tar -C / -Jxpf - \
    \
    && curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-symlinks-noarch.tar.xz" \
        | tar -C / -Jxpf - \
    \
    && curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-symlinks-arch.tar.xz" \
        | tar -C / -Jxpf - \
    \
    && mkdir -p /etc/fix-attrs.d \
    && mkdir -p /etc/services.d \
    \
    && apt-get purge -y --auto-remove \
        xz-utils \
    && apt-get clean \
    && rm -fr \
        /tmp/* \
        /var/{cache,log}/* \
        /var/lib/apt/lists/*

ENTRYPOINT [ "/init" ]

COPY ./docker/rootfs /

RUN mkdir /var/run/sshd

WORKDIR /opt/typedaemon

COPY --from=builder /opt/typedaemon .
COPY --from=static_bin /output node_modules/typedaemon/skel/bin

COPY ./docker/td /usr/bin/td
COPY ./docker/startup.sh ./startup.sh
RUN chmod +x /usr/bin/td \
    && chmod +x ./startup.sh

ENV S6_KEEP_ENV 1
ENV TYPEDAEMON_MODULE /opt/typedaemon/node_modules/typedaemon
ENV TYPEDAEMON_ENV production
ENV TYPEDAEMON_CONFIG /config

CMD [ "./startup.sh" ]
