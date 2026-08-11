FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
ENV KP_HTTP_HOST=0.0.0.0
WORKDIR /app
RUN addgroup -S mcp && adduser -S -G mcp mcp
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER mcp
EXPOSE 8788
CMD ["node", "src/http.js"]
