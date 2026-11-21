FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS build

# Install exactly what package-lock.json pins, without the dev tools.
WORKDIR /opt/commitlint-config
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.mjs ./
COPY lib/ lib/
COPY bin/ bin/

# Alpine's own nodejs package rather than the node image: a CI job pulls this
# image on every merge request, and the node image's runtime layer alone
# outweighs this whole image (57 MB against 37 MB compressed).
FROM alpine:3.23@sha256:469c9ea410b9215eaee7976ba6c0639039b444be8e5d638f7abbada189971eb2
# git: commitlint-range reads the commits of the range it lints. A CI job runs
# this image on a checkout owned by another user (GitLab clones as root, the
# job runs as node), which git refuses as "dubious ownership" unless trusted.
# The distribution's security fixes published since the base image was built
# come last.
RUN apk add --no-cache nodejs git \
    && git config --system --add safe.directory '*' \
    && adduser -D -u 1000 -h /home/node node \
    && apk upgrade --no-cache
COPY --from=build /opt/commitlint-config /opt/commitlint-config
RUN ln -s /opt/commitlint-config/bin/commitlint-range.mjs /usr/local/bin/commitlint-range \
    && ln -s /opt/commitlint-config/bin/commit-tree-check.mjs /usr/local/bin/commit-tree-check \
    && ln -s /opt/commitlint-config/node_modules/.bin/commitlint /usr/local/bin/commitlint
USER node
ENTRYPOINT []
CMD ["commitlint-range", "--version"]
