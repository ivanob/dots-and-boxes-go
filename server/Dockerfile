# Stage 1: Build Go plugin with a toolchain that matches Nakama.
FROM heroiclabs/nakama-pluginbuilder:3.22.0 AS builder

WORKDIR /build
COPY go_modules/go.mod ./go.mod
COPY go_modules/main.go ./main.go

RUN go mod tidy

# Build the plugin
RUN go build --trimpath --buildmode=plugin -o backend.so .

# Stage 2: Nakama runtime
FROM heroiclabs/nakama:3.22.0

# Copy the compiled plugin
COPY --from=builder /build/backend.so /nakama/data/modules/

# Copy Nakama configuration
COPY local.yml /nakama/data/

WORKDIR /nakama
