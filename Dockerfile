# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /workspace

# Copy seegak local packages (with pre-built dist/)
COPY seegak/packages/core            /workspace/seegak/packages/core
COPY seegak/packages/bio-charts      /workspace/seegak/packages/bio-charts
COPY seegak/packages/react           /workspace/seegak/packages/react
COPY seegak/packages/human-body-map  /workspace/seegak/packages/human-body-map
COPY seegak/packages/genomics        /workspace/seegak/packages/genomics
COPY seegak/packages/spatial         /workspace/seegak/packages/spatial
COPY seegak/packages/analysis        /workspace/seegak/packages/analysis
COPY seegak/packages/3d              /workspace/seegak/packages/3d
COPY seegak/packages/coordination    /workspace/seegak/packages/coordination
COPY seegak/packages/data-loaders    /workspace/seegak/packages/data-loaders

# Copy frontend project
COPY seegak-test/package.json seegak-test/package-lock.json /workspace/seegak-test/
WORKDIR /workspace/seegak-test

# Remove local file: deps before npm install (resolved via vite alias instead)
RUN node -e "\
  const pkg = require('./package.json');\
  const locals = ['@seegak/core','@seegak/bio-charts','@seegak/react','@seegak/human-body-map','@seegak/genomics','@seegak/spatial','@seegak/analysis','@seegak/3d','@seegak/coordination','@seegak/data-loaders'];\
  locals.forEach(n => { if(pkg.dependencies[n]) delete pkg.dependencies[n]; });\
  require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2));"

RUN npm install --legacy-peer-deps

# Copy source
COPY seegak-test/ /workspace/seegak-test/

# Tell vite.config.ts to use resolve.alias for @seegak/* packages
ENV DOCKER_BUILD=1

# Skip tsc type-check; Vite/esbuild handles transpilation
RUN npx vite build

# ── Stage 2: Serve with nginx ──────────────────────────────────
FROM nginx:alpine

COPY --from=builder /workspace/seegak-test/dist /usr/share/nginx/html

# Custom nginx config for SPA routing
RUN printf 'server {\n\
    listen 5000;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|wasm)$ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 5000

CMD ["nginx", "-g", "daemon off;"]
