# syntax=docker/dockerfile:1.12@sha256:93bfd3b68c109427185cd78b4779fc82b484b0b7618e36d0f104d4d801e66d25
# Keep this source-independent stage identical in both image recipes.
FROM docker.io/library/rust:1.97.1-bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 AS rust_oracle_tools
ENV SOURCE_DATE_EPOCH=0
RUN cargo install --locked --root /opt/prismpm/rust-oracle-tools wasm-bindgen-cli --version 0.2.122
RUN cargo install --locked --root /opt/prismpm/rust-oracle-tools wasm-tools --version 1.258.0
RUN cargo install --locked --root /opt/prismpm/rust-oracle-tools wasmtime-cli --version 48.0.1
RUN cargo install --locked --root /opt/prismpm/rust-oracle-tools cargo-local-registry --version 0.2.12

FROM docker.io/library/rust:1.97.1-bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 AS input_tools
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) node_arch=x64; node_sha=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307 ;; \
      arm64) node_arch=arm64; node_sha=fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8 ;; \
      *) exit 64 ;; \
    esac \
    && curl --fail --location --silent --show-error "https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-${node_arch}.tar.xz" --output /tmp/node.tar.xz \
    && echo "${node_sha}  /tmp/node.tar.xz" | sha256sum --check --strict \
    && tar --extract --xz --file /tmp/node.tar.xz --strip-components=1 --directory /usr/local \
    && rm /tmp/node.tar.xz

FROM input_tools AS source_inputs
ARG SDK_SOURCE_REVISION
# Only the bounded verifier and its independently selected policy enter from
# the caller context. All compiled source is reconstructed from verified packs.
COPY scripts/sdk-vv-inputs.mjs scripts/sdk-image-inputs.mjs /opt/input-policy/scripts/
COPY sdk/Dockerfile sdk/vv-inputs.lock.json /opt/input-policy/sdk/
COPY tools.lock /opt/input-policy/
COPY --from=vv-inputs / /opt/prismpm/share/vv-inputs/
RUN node /opt/input-policy/scripts/sdk-image-inputs.mjs stage \
      /opt/prismpm/share/vv-inputs /opt/input-policy "$SDK_SOURCE_REVISION" /prepared \
    && cp /prepared/policy.json /opt/prismpm/share/vv-input-policy.json \
    && chmod -R a+rX,a-w /opt/prismpm/share/vv-inputs \
    && chmod 0444 /opt/prismpm/share/vv-input-policy.json

FROM docker.io/library/docker:28.4.0-cli@sha256:6a73c9433f2ba4279815be1e60f5739288b939dda1e48151d8c393537802de37 AS docker_cli
FROM input_tools AS registry_qualification_tools
ARG TARGETARCH
# The digest-pinned Bookworm base supplies this interpreter. Refuse missing or
# different runtimes rather than falling back to Python installed on the host.
RUN /usr/bin/python3 -I -B -c 'import sys; assert sys.version_info[:3] == (3, 11, 2)'
COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker_cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
RUN case "$TARGETARCH" in \
      amd64) oras_arch=amd64; oras_sha=6cdc692f929100feb08aa8de584d02f7bcc30ec7d88bc2adc2054d782db57c64 ;; \
      arm64) oras_arch=arm64; oras_sha=7649738b48fde10542bcc8b0e9b460ba83936c75fb5be01ee6d4443764a14352 ;; \
      *) exit 64 ;; \
    esac \
    && curl --fail --location --silent --show-error "https://github.com/oras-project/oras/releases/download/v1.3.0/oras_1.3.0_linux_${oras_arch}.tar.gz" --output /tmp/oras.tar.gz \
    && echo "${oras_sha}  /tmp/oras.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/oras.tar.gz --directory /usr/local/bin oras \
    && rm /tmp/oras.tar.gz \
    && openssl version \
    && docker buildx version \
    && test "$(node --version)" = v22.23.2

FROM docker.io/library/golang:1.19.7-alpine3.17@sha256:04065e607052705ede1ac6308ce56aec4715b0fafb1f0c2f4c2333aab9d84442 AS upstream_oracles
COPY --from=source_inputs /prepared/source/standards/oracles/oci-distribution-1.1.1 /src/distribution
COPY --from=source_inputs /prepared/source/standards/oracles/oci-runtime-1.3.0 /src/runtime
COPY --from=source_inputs /prepared/source/standards/oracles/oci-image-1.1.1 /src/image
RUN cd /src/distribution \
    && CGO_ENABLED=0 go test -c -o /oci-distribution-conformance --ldflags='-X github.com/opencontainers/distribution-spec/conformance.Version=a139cc423184af6078077b9b7ee336eddbd03f8f' \
    && cd /src/runtime \
    && CGO_ENABLED=0 go build -trimpath -o /oci-runtime-validate ./validate.go \
    && cd /src/image \
    && CGO_ENABLED=0 go test -c -o /oci-image-schema-conformance ./schema
FROM docker.io/library/golang:1.23.8-alpine3.21@sha256:b7486658b87d34ecf95125e5b97e8dfe86c21f712aa36fc0c702e5dc41dc63e1 AS cloudevents_oracle
COPY --from=source_inputs /prepared/source/standards/oracles/cloudevents-sdk-go-2.16.2 /src/cloudevents
COPY --from=source_inputs /prepared/source/sdk/oracles/go/cloudevents-validator /src/cloudevents-wrapper
COPY --from=source_inputs /prepared/source/standards/oracles/in-toto-attestation-ee16c68a /src/intoto
COPY --from=source_inputs /prepared/source/sdk/oracles/go/intoto-statement-validator /src/intoto-wrapper
RUN cd /src/cloudevents/v2 \
    && CGO_ENABLED=0 go test -c -o /cloudevents-sdk-conformance ./event \
    && cd /src/cloudevents-wrapper \
    && go mod edit -replace github.com/cloudevents/sdk-go/v2=/src/cloudevents/v2 \
    && CGO_ENABLED=0 go build -trimpath -o /cloudevents-validator . \
    && cd /src/intoto-wrapper \
    && go mod edit -replace github.com/in-toto/attestation=/src/intoto \
    && CGO_ENABLED=0 go build -trimpath -o /intoto-statement-validator .
FROM docker.io/library/maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS openid_oracle
COPY --from=source_inputs /prepared/source/standards/oracles/openid-conformance-suite-3e09b13b /src/openid
RUN cd /src/openid \
    && mvn --batch-mode --quiet \
      -Dmaven.gitcommitid.skip=true \
      -Djacoco.skip=true \
      -Dtest=ValidateIdTokenSignature_UnitTest,OIDCCValidateRequestObjectExp_UnitTest,CheckDiscEndpointIssuer_UnitTest,CheckDiscEndpointIssuerIsValidUrl_UnitTest \
      test
RUN find /root/.m2/repository -type f \( -name '*.lastUpdated' -o -name '_remote.repositories' -o -name 'resolver-status.properties' -o -name 'maven-metadata-*.xml' -o -name 'maven-metadata-*.xml.sha1' \) -delete \
    && rm -f /src/openid/target/classes/META-INF/build-info.properties /src/openid/target/classes/git.properties \
    && find /root/.m2/repository /src/openid/target/classes /src/openid/target/test-classes -exec touch -h -d '@0' '{}' +
FROM input_tools AS build

ARG TARGETARCH
ARG SOURCE_DATE_EPOCH=0
ENV ELAN_HOME=/usr/local/elan \
    SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH \
    PATH=/usr/local/elan/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin

RUN rustup component add rustfmt clippy rust-analyzer \
    && rustup target add \
      aarch64-unknown-linux-gnu \
      thumbv7em-none-eabihf \
      wasm32-unknown-unknown \
      x86_64-unknown-linux-gnu

RUN case "$TARGETARCH" in \
      amd64) elan_arch=x86_64; elan_sha=df0b2b3a439961ffcbb3985214365ffe40f49bc871df04dff268c7d8e21ca8b2 ;; \
      arm64) elan_arch=aarch64; elan_sha=cb69af0803b04157bc30201c29c12fca882bb3ad8b43476b8d2d3064810bc3ac ;; \
      *) exit 64 ;; \
    esac \
    && curl --fail --location --silent --show-error "https://github.com/leanprover/elan/releases/download/v4.2.3/elan-${elan_arch}-unknown-linux-gnu.tar.gz" --output /tmp/elan.tar.gz \
    && echo "${elan_sha}  /tmp/elan.tar.gz" | sha256sum --check --strict \
    && mkdir /tmp/elan \
    && tar --extract --gzip --file /tmp/elan.tar.gz --directory /tmp/elan \
    && /tmp/elan/elan-init -y --no-modify-path --default-toolchain none \
    && elan toolchain install leanprover/lean4:v4.32.1 \
    && chmod -R a+rX,go-w /usr/local/elan/toolchains/leanprover--lean4---v4.32.1 \
    && rm /tmp/elan.tar.gz \
    && rm /tmp/elan/elan-init \
    && rmdir /tmp/elan

COPY --from=rust_oracle_tools /opt/prismpm/rust-oracle-tools/bin/ /usr/local/cargo/bin/
RUN rm -rf /usr/local/cargo/registry /usr/local/cargo/git

RUN case "$TARGETARCH" in \
      amd64) archive=just-1.57.0-x86_64-unknown-linux-musl.tar.gz; checksum=45b548094283cb9739af8f13273b8cddeee869f5b4ef2bb631b1f311cb566155 ;; \
      arm64) archive=just-1.57.0-aarch64-unknown-linux-musl.tar.gz; checksum=f225044a81adea6e0b3a8b9370aaf374e6af76c8735ae263ac993df55fd137ec ;; \
      *) exit 64 ;; \
    esac \
    && curl --fail --location --silent --show-error "https://github.com/casey/just/releases/download/1.57.0/${archive}" --output /tmp/just.tar.gz \
    && echo "${checksum}  /tmp/just.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/just.tar.gz --directory /usr/local/bin just \
    && rm /tmp/just.tar.gz

RUN case "$TARGETARCH" in \
      amd64) deny_arch=x86_64; deny_sha=9f12ed4c49936e09b48bf862b595cde2fe64fcbd9d74dfacac6131ca824c8d5f ;; \
      arm64) deny_arch=aarch64; deny_sha=995c82be0defc7a025cae49a2aa2644ce8245c9a3318fc4103907c6a285e8c7d ;; \
      *) exit 64 ;; \
    esac \
    && archive="cargo-deny-0.20.2-${deny_arch}-unknown-linux-musl.tar.gz" \
    && curl --fail --location --silent --show-error "https://github.com/EmbarkStudios/cargo-deny/releases/download/0.20.2/${archive}" --output /tmp/cargo-deny.tar.gz \
    && echo "${deny_sha}  /tmp/cargo-deny.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/cargo-deny.tar.gz --strip-components=1 --directory /usr/local/bin "cargo-deny-0.20.2-${deny_arch}-unknown-linux-musl/cargo-deny" \
    && rm /tmp/cargo-deny.tar.gz

RUN case "$TARGETARCH" in \
      amd64) oras_arch=amd64; oras_sha=6cdc692f929100feb08aa8de584d02f7bcc30ec7d88bc2adc2054d782db57c64; kind_sha=eb244cbafcc157dff60cf68693c14c9a75c4e6e6fedaf9cd71c58117cb93e3fa; kubectl_sha=8b8f088da2dab964f853b38464033b1be15ede2839eca751482357c45abdd05a; cosign_sha=4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71; compose_arch=x86_64; compose_sha=837fd1d35bf6a494f41b5b5988269a7be79de337cf1a1a6ff0e45ab51bb4e9be ;; \
      arm64) oras_arch=arm64; oras_sha=7649738b48fde10542bcc8b0e9b460ba83936c75fb5be01ee6d4443764a14352; kind_sha=8e1014e87c34901cc422a1445866835d1e666f2a61301c27e722bdeab5a1f7e4; kubectl_sha=0ecf44450ee6063bf19dd166a103ee6df4a9034455c2abce626e6eea657d73fb; cosign_sha=c5d324e091826b0d7a78eb16fef316450b4eb9aaec045611c08ba06f5e73220a; compose_arch=aarch64; compose_sha=fc5d1371f1ec7987e703da94ede49af3fbfb240b83f22991a98511de7bc4b93b ;; \
      *) exit 64 ;; \
    esac \
    && curl --fail --location --silent --show-error "https://github.com/oras-project/oras/releases/download/v1.3.0/oras_1.3.0_linux_${oras_arch}.tar.gz" --output /tmp/oras.tar.gz \
    && echo "${oras_sha}  /tmp/oras.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/oras.tar.gz --directory /usr/local/bin oras \
    && curl --fail --location --silent --show-error "https://github.com/kubernetes-sigs/kind/releases/download/v0.31.0/kind-linux-${oras_arch}" --output /usr/local/bin/kind \
    && echo "${kind_sha}  /usr/local/bin/kind" | sha256sum --check --strict \
    && curl --fail --location --silent --show-error "https://dl.k8s.io/release/v1.36.4/bin/linux/${oras_arch}/kubectl" --output /usr/local/bin/kubectl \
    && echo "${kubectl_sha}  /usr/local/bin/kubectl" | sha256sum --check --strict \
    && curl --fail --location --silent --show-error "https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-${oras_arch}" --output /usr/local/bin/cosign \
    && echo "${cosign_sha}  /usr/local/bin/cosign" | sha256sum --check --strict \
    && mkdir -p /usr/local/libexec/docker/cli-plugins \
    && curl --fail --location --silent --show-error "https://github.com/docker/compose/releases/download/v5.4.0/docker-compose-linux-${compose_arch}" --output /usr/local/libexec/docker/cli-plugins/docker-compose \
    && echo "${compose_sha}  /usr/local/libexec/docker/cli-plugins/docker-compose" | sha256sum --check --strict \
    && chmod 0755 /usr/local/bin/oras /usr/local/bin/kind /usr/local/bin/kubectl /usr/local/bin/cosign /usr/local/libexec/docker/cli-plugins/docker-compose \
    && ln -s /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose \
    && rm /tmp/oras.tar.gz

RUN case "$TARGETARCH" in \
      amd64) slsa_arch=amd64; slsa_sha=946dbec729094195e88ef78e1734324a27869f03e2c6bd2f61cbc06bd5350339; otel_arch=amd64; otel_sha=e642146998b9559929c34f5b85525e27ca6430585e2951fa88a403ff5ebf9f47; osv_sha=15314940c10d26af9c6649f150b8a47c1262e8fc7e17b1d1029b0e479e8ed8a0 ;; \
      arm64) slsa_arch=arm64; slsa_sha=5d3b2349ede7bfec19e7a21569f18b9f7410145ad12e9584b175370669e14061; otel_arch=arm64; otel_sha=f768015766c8ace50caf9130ad0f38e4781f76b9abe4380b26c875108bb51899; osv_sha=44e580752910f0ff36ec99aff59af20f65df1e859aa31e5605a8f0d055b496e9 ;; \
      *) exit 64 ;; \
    esac \
    && curl --fail --location --silent --show-error "https://github.com/slsa-framework/slsa-verifier/releases/download/v2.7.1/slsa-verifier-linux-${slsa_arch}" --output /usr/local/bin/slsa-verifier \
    && echo "${slsa_sha}  /usr/local/bin/slsa-verifier" | sha256sum --check --strict \
    && curl --fail --location --silent --show-error "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.136.0/otelcol-contrib_0.136.0_linux_${otel_arch}.tar.gz" --output /tmp/otelcol.tar.gz \
    && echo "${otel_sha}  /tmp/otelcol.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/otelcol.tar.gz --directory /usr/local/bin otelcol-contrib \
    && curl --fail --location --silent --show-error "https://github.com/google/osv-scanner/releases/download/v2.4.0/osv-scanner_linux_${slsa_arch}" --output /usr/local/bin/osv-scanner \
    && echo "${osv_sha}  /usr/local/bin/osv-scanner" | sha256sum --check --strict \
    && chmod 0755 /usr/local/bin/slsa-verifier /usr/local/bin/otelcol-contrib /usr/local/bin/osv-scanner \
    && rm /tmp/otelcol.tar.gz

COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker_cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
RUN ln -s /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/bin/docker-buildx
COPY --from=upstream_oracles --chmod=0755 /oci-distribution-conformance /usr/local/bin/oci-distribution-conformance
COPY --from=upstream_oracles --chmod=0755 /oci-runtime-validate /usr/local/bin/oci-runtime-validate
COPY --from=upstream_oracles --chmod=0755 /oci-image-schema-conformance /usr/local/bin/oci-image-schema-conformance
COPY --from=cloudevents_oracle --chmod=0755 /cloudevents-sdk-conformance /usr/local/bin/cloudevents-sdk-conformance
COPY --from=cloudevents_oracle --chmod=0755 /cloudevents-validator /usr/local/bin/cloudevents-validator
COPY --from=cloudevents_oracle --chmod=0755 /intoto-statement-validator /usr/local/bin/intoto-statement-validator
COPY --from=openid_oracle /usr/share/maven /opt/prismpm/openid-maven
COPY --from=openid_oracle /opt/java/openjdk /opt/prismpm/openid-java
COPY --from=openid_oracle /root/.m2/repository /opt/prismpm/openid-m2
COPY --from=openid_oracle /src/openid/target/classes /opt/prismpm/openid-target/classes
COPY --from=openid_oracle /src/openid/target/test-classes /opt/prismpm/openid-target/test-classes
COPY --from=source_inputs /prepared/source/sdk/bootstrap/ /opt/prismpm/bootstrap-tools/
RUN node /opt/prismpm/bootstrap-tools/install.mjs
COPY --from=source_inputs --chmod=0755 /prepared/source/sdk/oracles/openid-conformance.sh /usr/local/bin/openid-conformance
COPY --from=source_inputs /prepared/source/sdk/devcontainer-cli/package.json /prepared/source/sdk/devcontainer-cli/package-lock.json /opt/prismpm/devcontainer-cli/
RUN npm ci --ignore-scripts --omit=dev --prefix /opt/prismpm/devcontainer-cli \
    && ln -s /opt/prismpm/devcontainer-cli/node_modules/@devcontainers/cli/devcontainer.js /usr/local/bin/devcontainer \
    && chmod 0755 /opt/prismpm/devcontainer-cli/node_modules/@devcontainers/cli/devcontainer.js

COPY --from=source_inputs /prepared/source/sdk/runtime/package.json /prepared/source/sdk/runtime/package-lock.json /prepared/source/sdk/runtime/profile.mjs /prepared/source/sdk/runtime/runtime.mjs /opt/prismpm/runtime/
COPY --from=source_inputs --chmod=0444 /prepared/source/sdk/browser/identity.mjs /prepared/source/sdk/browser/store.mjs /prepared/source/sdk/browser/peer.mjs /prepared/source/sdk/browser/journal.mjs /prepared/source/sdk/browser/commands.mjs /prepared/source/sdk/browser/queries.mjs /prepared/source/sdk/browser/view-host.mjs /prepared/source/sdk/browser/view-dom.mjs /prepared/source/sdk/browser/view-error.mjs /prepared/source/sdk/browser/rs256.mjs /prepared/source/sdk/browser/effects.mjs /prepared/source/sdk/browser/effects-wire.mjs /prepared/source/sdk/browser/effects-module.mjs /prepared/source/sdk/browser/presentation-wire.mjs /prepared/source/sdk/browser/presentation-dom.mjs /prepared/source/sdk/browser/semantic-presentation-wire.mjs /prepared/source/sdk/browser/semantic-presentation-style.mjs /prepared/source/sdk/browser/credential-custody.mjs /prepared/source/sdk/browser/operation-journal.mjs /prepared/source/sdk/browser/account-genesis.mjs /prepared/source/sdk/browser/account-genesis-binding.mjs /prepared/source/sdk/browser/signed-context.mjs /prepared/source/sdk/browser/session-retention-wire.mjs /prepared/source/sdk/browser/session-storage.mjs /prepared/source/sdk/browser/session-payloads.mjs /prepared/source/sdk/browser/session-operation-capture.mjs /prepared/source/sdk/browser/pkce.mjs /opt/prismpm/browser/
RUN npm ci --ignore-scripts --omit=dev --prefix /opt/prismpm/runtime \
    && chmod 0444 /opt/prismpm/runtime/profile.mjs \
    && chmod 0555 /opt/prismpm/runtime/runtime.mjs

COPY --from=source_inputs /prepared/source/sdk/oracles/package.json /prepared/source/sdk/oracles/package-lock.json /prepared/source/sdk/oracles/asyncapi-parser.mjs /prepared/source/sdk/oracles/devcontainer-validator.mjs /prepared/source/sdk/oracles/git-signature-validator.mjs /prepared/source/sdk/oracles/kubernetes-validator.mjs /prepared/source/sdk/oracles/kubernetes-validator.test.mjs /prepared/source/sdk/oracles/slsa-validator.mjs /prepared/source/sdk/oracles/spdx-validator.mjs /opt/prismpm/oracles/
RUN npm ci --ignore-scripts --omit=dev --prefix /opt/prismpm/oracles \
    && chmod 0555 /opt/prismpm/oracles/asyncapi-parser.mjs /opt/prismpm/oracles/devcontainer-validator.mjs /opt/prismpm/oracles/git-signature-validator.mjs /opt/prismpm/oracles/kubernetes-validator.mjs /opt/prismpm/oracles/slsa-validator.mjs /opt/prismpm/oracles/spdx-validator.mjs \
    && ln -s /opt/prismpm/oracles/asyncapi-parser.mjs /usr/local/bin/asyncapi-parser \
    && ln -s /opt/prismpm/oracles/devcontainer-validator.mjs /usr/local/bin/devcontainer-validator \
    && ln -s /opt/prismpm/oracles/git-signature-validator.mjs /usr/local/bin/git-signature-validator \
    && ln -s /opt/prismpm/oracles/kubernetes-validator.mjs /usr/local/bin/kubernetes-validator \
    && ln -s /opt/prismpm/oracles/slsa-validator.mjs /usr/local/bin/slsa-validator \
    && ln -s /opt/prismpm/oracles/spdx-validator.mjs /usr/local/bin/spdx-validator \
    && printf '%s' '{"asyncapi":"3.1.0","channels":{},"info":{"title":"SDK oracle fixture","version":"1"}}' >/tmp/asyncapi-valid.json \
    && /usr/local/bin/asyncapi-parser /tmp/asyncapi-valid.json \
    && printf '%s' '{"asyncapi":"3.1.0","channels":{},"info":{}}' >/tmp/asyncapi-invalid.json \
    && ! /usr/local/bin/asyncapi-parser /tmp/asyncapi-invalid.json \
    && rm /tmp/asyncapi-valid.json /tmp/asyncapi-invalid.json

COPY --from=source_inputs /opt/prismpm/share/vv-inputs/ /opt/prismpm/share/vv-inputs/
COPY --from=source_inputs /opt/prismpm/share/vv-input-policy.json /opt/prismpm/share/vv-input-policy.json
WORKDIR /opt/prismpm/source
COPY --from=source_inputs /prepared/source/ .
RUN mkdir -p /opt/prismpm/asyncapi-official/scripts \
    && cp -a standards/oracles/asyncapi-spec-b3fac5bb/spec /opt/prismpm/asyncapi-official/spec \
    && cp -a standards/oracles/asyncapi-spec-b3fac5bb/scripts/validation /opt/prismpm/asyncapi-official/scripts/validation \
    && cp sdk/asyncapi-runtime/package.json sdk/asyncapi-runtime/package-lock.json \
      sdk/asyncapi-runtime/launcher.mjs sdk/asyncapi-runtime/launcher.sh \
      sdk/asyncapi-runtime/launcher.test.mjs \
      /opt/prismpm/asyncapi-official/scripts/ \
    && npm ci --ignore-scripts --include=dev --no-audit --no-fund --prefix /opt/prismpm/asyncapi-official/scripts \
    && node --test --test-reporter=tap --test-timeout=180000 /opt/prismpm/asyncapi-official/scripts/launcher.test.mjs \
    && chmod 0555 /opt/prismpm/asyncapi-official/scripts/launcher.sh \
    && ln -s /opt/prismpm/asyncapi-official/scripts/launcher.sh /usr/local/bin/asyncapi-official \
    && chmod -R a-w /opt/prismpm/asyncapi-official
RUN mkdir -p /opt/prismpm/share/standards/oracles \
    && cp standards/oracles/devcontainer-c95ffeed-base.schema.json \
      /opt/prismpm/share/standards/oracles/devcontainer-c95ffeed-base.schema.json \
    && cp standards/oracles/kubernetes-1.36.4-swagger.json \
      /opt/prismpm/share/standards/oracles/kubernetes-1.36.4-swagger.json
RUN cargo build --locked --release --package prismpm \
    && target/release/prismpm --json --project . authority resolve --locked \
    && cargo build --locked --release --package repo-conformance --bins \
    && cargo build --locked --release --manifest-path vendor/lexlean/Cargo.toml --bin lexlean \
    && cargo fetch --locked \
    && cargo fetch --locked --manifest-path vendor/lexlean/Cargo.toml \
    && bash scripts/fetch-oracle-cargo.sh \
    && mkdir -p /opt/prismpm/share \
    && node sdk/generate-account-genesis.mjs install \
    && install -m 0755 target/release/prismpm /usr/local/bin/prismpm \
    && install -m 0755 target/release/prismpm-conformance /usr/local/bin/prismpm-conformance \
    && install -m 0755 target/release/prismpm-platform-equivalence /usr/local/bin/prismpm-platform-equivalence \
    && install -m 0755 vendor/lexlean/target/release/lexlean /usr/local/bin/lexlean \
    && echo '844a1c6de3986c9f02070266b25e0d1a2fa99ceccc89f6b9ad90aae47b62a16e  standards/trust/sigstore-trusted-root-cosign-3.1.3.json' | sha256sum --check --strict \
    && echo 'e33e1416f08d6ee24f1c66f3895be7d919ff58c0d4318f2934ec4743f75f0a7e  standards/trust/github-sudo-bmitch-openpgp-6e0ff28c767a8bee.asc' | sha256sum --check --strict \
    && echo 'cf122ae443d3fcad8b90fe30277d3c37e008c60d56c9658a44848bdb6f2078d4  standards/trust/github-akihirosuda-openpgp-49524c6f9f638f1a.asc' | sha256sum --check --strict \
    && echo '929c5c98f56be683921c84a1ccd542d0d8df3e75657c3711d5557da35267b637  standards/trust/github-hayden-io-ssh-zjmejzisa.pub' | sha256sum --check --strict \
    && echo 'c0f83ab885c007561550bda8d540e620b2ac4e36af0a4b48cd320854a3cf2ea4  standards/trust/github-songy23-ssh-sfmatr1d.pub' | sha256sum --check --strict \
    && devcontainer-validator standards/corpora/devcontainer-c95ffeed/valid-minimal.json \
    && ! devcontainer-validator standards/corpora/devcontainer-c95ffeed/invalid-image-type.json \
    && kubernetes-validator standards/corpora/kubernetes-1.36.4/valid-service.yaml \
    && ! kubernetes-validator standards/corpora/kubernetes-1.36.4/invalid-pod.yaml \
    && node --test /opt/prismpm/oracles/kubernetes-validator.test.mjs \
    && slsa-validator --provenance standards/corpora/slsa-verifier-2.7.1/binary-linux-amd64-workflow_dispatch.intoto.sigstore --trusted-root standards/trust/sigstore-trusted-root-cosign-3.1.3.json --source-uri github.com/slsa-framework/example-package --certificate-identity 'https://github.com/slsa-framework/slsa-github-generator/.github/workflows/builder_container-based_slsa3.yml@refs/tags/v1.7.0' --certificate-oidc-issuer https://token.actions.githubusercontent.com standards/corpora/slsa-verifier-2.7.1/binary-linux-amd64-workflow_dispatch \
    && ! slsa-validator --provenance standards/corpora/slsa-verifier-2.7.1/binary-linux-amd64-workflow_dispatch.intoto.sigstore --trusted-root standards/trust/sigstore-trusted-root-cosign-3.1.3.json --source-uri github.com/slsa-framework/example-package --certificate-identity 'https://github.com/slsa-framework/slsa-github-generator/.github/workflows/builder_container-based_slsa3.yml@refs/tags/v1.7.0' --certificate-oidc-issuer https://token.actions.githubusercontent.com standards/corpora/devcontainer-c95ffeed/invalid-image-type.json \
    && mkdir -p /opt/prismpm/share \
    && mkdir -p /opt/prismpm/share/conformance-root \
    && cp -a . /opt/prismpm/share/conformance-root/ \
    && rm -rf /opt/prismpm/share/conformance-root/target /opt/prismpm/share/conformance-root/vendor/lexlean/target \
    && cp sdk/stdlib-sources.tar standards.lock /opt/prismpm/share/ \
    && cp CHANGELOG.md CONFORMANCE.md CONTRACTS.md ERRORS.md LICENSE-APACHE LICENSE-MIT README.md RELEASE-STATUS.md SPEC.md /opt/prismpm/share/ \
    && cp -a action adapters schemas standards /opt/prismpm/share/ \
    && mkdir -p /opt/prismpm/share/stdlib/generated \
    && cp stdlib/README.md stdlib/release.json /opt/prismpm/share/stdlib/ \
    && cp stdlib/generated/prism-stdlib-0.2.0.crate /opt/prismpm/share/stdlib/generated/ \
    && mkdir -p /opt/prismpm/share/workflows \
    && cp .github/workflows/sdk.yml /opt/prismpm/share/workflows/sdk.yml \
    && rm -rf target vendor/lexlean/target

COPY --from=source_inputs --chmod=0755 /prepared/source/sdk/devcontainer-init.sh /usr/local/bin/prismpm-devcontainer-init
COPY --from=source_inputs --chmod=0444 /prepared/source/sdk/profile.sh /etc/profile.d/prismpm-sdk.sh
COPY --from=source_inputs --chmod=0444 /prepared/source/sdk/generate-inventory.mjs /opt/prismpm/generate-inventory.mjs
COPY --from=source_inputs --chmod=0444 /prepared/source/sdk/inventory-metadata.mjs /opt/prismpm/inventory-metadata.mjs
COPY --from=source_inputs --chmod=0444 /prepared/source/sdk/exporter-seed.mjs /opt/prismpm/exporter-seed.mjs
COPY --from=source_inputs --chmod=0444 /prepared/source/sdk/platform-lock.mjs /opt/prismpm/platform-lock.mjs
COPY --from=source_inputs --chmod=0444 /prepared/source/sdk/metadata-cli.mjs /prepared/source/sdk/metadata-capture.mjs /prepared/source/sdk/metadata-layer.mjs /prepared/source/sdk/metadata-transport.mjs /prepared/source/sdk/metadata-credentials.mjs /prepared/source/sdk/metadata-helper.mjs /prepared/source/sdk/metadata-helper-supervisor.py /opt/prismpm/

RUN set -eu; \
    PRISMPM_ARTIFACTS_ONLY=1 node sdk/generate-inventory.mjs /opt/prismpm/artifact-inventory.json

RUN chmod -R a+rX,a-w /opt/prismpm/share

RUN mkdir -p /opt/prismpm/cargo-home \
    && cp -a /usr/local/cargo/registry /opt/prismpm/cargo-home/ \
    && if [ -d /usr/local/cargo/git ]; then cp -a /usr/local/cargo/git /opt/prismpm/cargo-home/; fi \
    && rm -rf /usr/local/cargo/registry /usr/local/cargo/git /opt/prismpm/source

FROM build AS cli-archive-package
ARG SDK_VERSION=0.3.0
ARG TARGETARCH
COPY --from=source_inputs /prepared/source/LICENSE-APACHE /prepared/source/LICENSE-MIT /prepared/source/README.md /tmp/native-licenses/
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) rust_target=x86_64-unknown-linux-gnu ;; \
      arm64) rust_target=aarch64-unknown-linux-gnu ;; \
      *) exit 64 ;; \
    esac; \
    stage=/tmp/prismpm-native; \
    mkdir -p "$stage/licenses" /out; \
    install -m 0755 /usr/local/bin/prismpm "$stage/prismpm"; \
    cp -a /tmp/native-licenses/. "$stage/licenses/"; \
    binary_sha=$(sha256sum "$stage/prismpm" | cut -d' ' -f1); \
    printf '{"artifacts":[{"digest":"sha256:%s","id":"prismpm","kind":"binary","version":"%s"}],"schema":"prismpm/sdk-artifact-inventory/1"}\n' "$binary_sha" "$SDK_VERSION" > "$stage/inventory.json"; \
    archive="prismpm-${SDK_VERSION}-${rust_target}.tar.gz"; \
    tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --create --file=- -C "$stage" . | gzip -n > "/out/$archive"; \
    (cd /out && sha256sum "$archive" > "$archive.sha256"); \
    rm -rf "$stage" /tmp/native-licenses

FROM scratch AS cli-archive
COPY --from=cli-archive-package /out/ /

FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e AS runtime_base
RUN /usr/bin/python3 -I -B -c 'import sys; assert sys.version_info[:3] == (3, 12, 3)'
RUN chmod -R a-w /ms-playwright

ARG SOURCE_DATE_EPOCH=0
COPY --from=source_inputs /prepared/source/sdk/runtime-os.lock /tmp/prismpm-runtime-os.lock

# Downstream template gates compile their small repository-specific policy
# crates inside the SDK. Resolve the native linker exclusively from one
# immutable Ubuntu archive snapshot; no consumer reaches a floating apt mirror.
RUN set -eu; \
    test "$(wc -l < /tmp/prismpm-runtime-os.lock)" -eq 5; \
    snapshot=$(sed -n 's/^snapshot=//p' /tmp/prismpm-runtime-os.lock); \
    build_essential=$(sed -n 's/^build-essential=//p' /tmp/prismpm-runtime-os.lock); \
    pkg_config=$(sed -n 's/^pkg-config=//p' /tmp/prismpm-runtime-os.lock); \
    test -n "$snapshot"; test -n "$build_essential"; test -n "$pkg_config"; \
    sed -i \
      "s#http://azure.archive.ubuntu.com/ubuntu/#${snapshot}#; s#http://security.ubuntu.com/ubuntu/#${snapshot}#" \
      /etc/apt/sources.list.d/ubuntu.sources \
    && rm /etc/apt/sources.list.d/nodesource.list \
    && test "$(find /etc/apt/sources.list.d -maxdepth 1 -type f ! -name ubuntu.sources -print -quit)" = "" \
    && apt-get update \
    && apt-get install --no-install-recommends --yes \
      "build-essential=${build_essential}" \
      "pkg-config=${pkg_config}" \
    && dpkg-query -W -f='${binary:Package}\t${Version}\n' \
      | LC_ALL=C sort > /usr/local/share/prismpm-runtime-dpkg.lock \
    && install -m 0444 /tmp/prismpm-runtime-os.lock /usr/local/share/prismpm-runtime-os.lock \
    && rm -rf /var/lib/apt/lists/* /tmp/prismpm-runtime-os.lock

COPY --from=build /usr/local/ /usr/local/
COPY --from=build /opt/prismpm/ /opt/prismpm/
COPY --from=build /etc/profile.d/prismpm-sdk.sh /etc/profile.d/prismpm-sdk.sh

RUN set -eu; \
    existing_user=$(getent passwd 1000 | head -n 1 | cut -d: -f1); \
    existing_group=$(getent group 1000 | head -n 1 | cut -d: -f1); \
    if [ -n "$existing_group" ] && [ "$existing_group" != vscode ]; then \
      /usr/sbin/groupmod --new-name vscode "$existing_group"; \
    elif [ -z "$existing_group" ]; then \
      /usr/sbin/groupadd --gid 1000 vscode; \
    fi; \
    if [ -n "$existing_user" ] && [ "$existing_user" != vscode ]; then \
      /usr/sbin/usermod --login vscode --home /home/vscode --move-home "$existing_user"; \
    elif [ -z "$existing_user" ]; then \
      /usr/sbin/useradd --uid 1000 --gid 1000 --home-dir /home/vscode --create-home --shell /bin/bash vscode; \
    fi; \
    mkdir -p /workspace /home/vscode/.cargo /home/vscode/.elan /home/vscode/.docker \
    && cp -a /opt/prismpm/cargo-home/. /home/vscode/.cargo/ \
    && chown -R 1000:1000 /workspace /home/vscode \
    && chmod -R a+rwX /home/vscode/.cargo /home/vscode/.elan /home/vscode/.docker \
    && chmod -R a+rX,a-w /opt/prismpm/cargo-home

ENV CARGO_HOME=/home/vscode/.cargo \
    RUSTUP_HOME=/usr/local/rustup \
    ELAN_HOME=/usr/local/elan \
    ELAN_TOOLCHAIN=leanprover/lean4:v4.32.1 \
    PRISMPM_SDK_INVENTORY=/opt/prismpm/share/inventory.json \
    PATH=/usr/local/elan/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin

RUN --network=none --mount=type=tmpfs,target=/tmp,size=805306368 \
    node /opt/prismpm/exporter-seed.mjs /opt/prismpm/share/conformance-root /opt/prismpm/share/exporter-seed \
    && PRISMPM_ARTIFACT_INVENTORY=/opt/prismpm/artifact-inventory.json \
      node /opt/prismpm/generate-inventory.mjs /opt/prismpm/share/inventory.json \
    && sha256sum /opt/prismpm/share/inventory.json > /opt/prismpm/share/inventory.sha256 \
    && chmod 0444 /opt/prismpm/share/inventory.json /opt/prismpm/share/inventory.sha256 \
    && rm /opt/prismpm/artifact-inventory.json /opt/prismpm/generate-inventory.mjs \
    && prismpm --json completion bash > /tmp/prismpm-sdk-self-check.json \
    && grep -Fq '"schema":"prismpm/completion-result/1"' /tmp/prismpm-sdk-self-check.json \
    && /usr/local/bin/asyncapi-official --check \
    && rm /tmp/prismpm-sdk-self-check.json

# The image entrypoint needs its initial root identity only when a devcontainer
# bind-mounts a host Docker socket: it discovers that socket's otherwise
# unknowable GID, joins the `vscode` user to it, and immediately execs the
# requested process as UID/GID 1000.  GitHub Actions supplies `--user`
# explicitly and never enters this initializer with elevated privileges.
RUN setpriv --reuid=1000 --regid=1000 --clear-groups \
      sh -ec 'test -z "$(find /opt/prismpm/share -type f ! -readable -print -quit)"'
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/prismpm-devcontainer-init"]
CMD []

# Publish exact installed metadata in a standalone terminal filesystem layer.
# --link includes the complete directory ancestry even when earlier layers
# already contain byte-identical files. No runtime files are added afterward.
FROM runtime_base AS metadata_files
RUN set -eu; \
    test -f /opt/prismpm/share/inventory.json \
    && test ! -L /opt/prismpm/share/inventory.json \
    && test -f /opt/prismpm/share/standards.lock \
    && test ! -L /opt/prismpm/share/standards.lock \
    && test "$(stat -c %s /opt/prismpm/share/inventory.json)" -le 8388608 \
    && test "$(stat -c %s /opt/prismpm/share/standards.lock)" -le 16777216 \
    && install -d -m 0755 /sdk-metadata/opt/prismpm/share \
    && install -m 0444 /opt/prismpm/share/inventory.json /sdk-metadata/opt/prismpm/share/inventory.json \
    && install -m 0444 /opt/prismpm/share/standards.lock /sdk-metadata/opt/prismpm/share/standards.lock \
    && cmp /opt/prismpm/share/inventory.json /sdk-metadata/opt/prismpm/share/inventory.json \
    && cmp /opt/prismpm/share/standards.lock /sdk-metadata/opt/prismpm/share/standards.lock \
    && touch -d @0 /sdk-metadata/opt /sdk-metadata/opt/prismpm /sdk-metadata/opt/prismpm/share \
      /sdk-metadata/opt/prismpm/share/inventory.json /sdk-metadata/opt/prismpm/share/standards.lock

FROM runtime_base AS runtime
COPY --link --from=metadata_files /sdk-metadata/ /
LABEL org.prismpm.sdk.metadata="prismpm/sdk-metadata/1"

# Redistributable adapters and upstream-oracle runners are published as
# independently addressable OCI packages.  They deliberately inherit the
# byte-identical, inventory-checked SDK implementation: a package is only a
# narrower distribution identity, never a second adapter/oracle
# implementation.  Consumers select these images by manifest-list digest.
FROM runtime AS adapter-compose
ENV PRISMPM_OCI_PACKAGE=adapter-compose
LABEL org.opencontainers.image.title="PrismPM Compose target adapter" \
      org.opencontainers.image.description="prismpm/target-adapter/1 Compose executable package"

FROM runtime AS adapter-kubernetes
ENV PRISMPM_OCI_PACKAGE=adapter-kubernetes
LABEL org.opencontainers.image.title="PrismPM Kubernetes target adapter" \
      org.opencontainers.image.description="prismpm/target-adapter/1 Kubernetes 1.36.4 executable package"

FROM runtime AS adapter-github-pages
ENV PRISMPM_OCI_PACKAGE=adapter-github-pages
LABEL org.opencontainers.image.title="PrismPM GitHub Pages target adapter" \
      org.opencontainers.image.description="prismpm/target-adapter/1 GitHub Pages executable package"

FROM runtime AS oracles
ENV PRISMPM_OCI_PACKAGE=standards-oracles
LABEL org.opencontainers.image.title="PrismPM standards oracles" \
      org.opencontainers.image.description="Immutable redistributable upstream-oracle runners and corpora"
