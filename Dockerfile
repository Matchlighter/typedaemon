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

WORKDIR /opt/typedaemon

COPY --from=builder /opt/typedaemon .

RUN mv td /usr/bin/td \
    && chmod +x /usr/bin/td \
    && chmod +x ./startup.sh

ENV TYPEDAEMON_ENV production
ENV TYPEDAEMON_CONFIG /config

CMD [ "./startup.sh" ]
