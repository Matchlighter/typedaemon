FROM node:18 AS builder

WORKDIR /opt/typedaemon_build

# Install Deps
COPY package.json yarn.lock ./
COPY patches patches
RUN yarn install --frozen-lockfile

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

# Remove src
RUN rm -rf src/ node_modules/ docker/

WORKDIR /opt/typedaemon

COPY ./docker .
RUN yarn install --production --frozen-lockfile
RUN yarn patch-package --patch-dir node_modules/typedaemon/patches/

# Build Runtime Image
FROM node:18

ARG TARGETARCH
ARG TARGETVARIANT

ARG S6_OVERLAY_VERSION="3.1.5.0"

RUN \
    apt-get update \
    \
    && apt-get install -y --no-install-recommends \
        bash \
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

WORKDIR /opt/typedaemon

COPY --from=builder /opt/typedaemon .

RUN mv td /usr/bin/td \
    && chmod +x /usr/bin/td \
    && chmod +x ./startup.sh

ENV TYPEDAEMON_ENV production
ENV TYPEDAEMON_CONFIG /config

# CMD [ "./startup.sh" ]
