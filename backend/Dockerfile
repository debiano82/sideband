FROM node:18-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends wireguard-tools iproute2 iptables procps \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js wg.js entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 8080
EXPOSE 51820/udp
ENTRYPOINT ["./entrypoint.sh"]
