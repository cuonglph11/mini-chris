FROM node:20-slim

WORKDIR /app

# Install ca-certificates, git, curl, gh CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    curl \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
COPY workspace/ ./workspace/
COPY mcp-servers.json ./
COPY config.example.yaml ./config.yaml

# Build TypeScript
RUN npm run build

EXPOSE 3000

# Default: start web UI (use Copilot adapter in Docker since Cursor CLI isn't available)
CMD ["node", "dist/cli.js", "web", "--port", "3000"]
