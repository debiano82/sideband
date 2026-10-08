FROM node:18-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
COPY cloud ./cloud
EXPOSE 4000
CMD ["node", "index.js"]
