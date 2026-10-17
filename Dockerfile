FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm install --omit=dev --build-from-source \
    && npm cache clean --force \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["npm", "start"]
