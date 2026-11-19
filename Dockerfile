FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build

# Install exactly what package-lock.json pins, without the dev tools.
WORKDIR /opt/commitlint-config
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.mjs ./
COPY lib/ lib/
COPY bin/ bin/

FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
COPY --from=build /opt/commitlint-config /opt/commitlint-config
# git: commitlint-range reads the commits of the range it lints. A CI job runs
# this image on a checkout owned by another user (GitLab clones as root, the
# job runs as node), which git refuses as "dubious ownership" unless trusted.
# The base image's npm, npx, corepack and yarn are never used at run time;
# removing them keeps their CVEs out of the image. The distribution's
# security fixes published since the base image was built come last.
RUN apk add --no-cache git \
    && git config --system --add safe.directory '*' \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v* \
    && ln -s /opt/commitlint-config/bin/commitlint-range.mjs /usr/local/bin/commitlint-range \
    && ln -s /opt/commitlint-config/node_modules/.bin/commitlint /usr/local/bin/commitlint \
    && apk upgrade --no-cache
USER node
ENTRYPOINT []
CMD ["commitlint-range", "--version"]
