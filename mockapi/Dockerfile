FROM node:22-alpine

RUN addgroup -g 1001 user0001 && \
    adduser -D -s /bin/sh -u 1001 -G user0001 user0001

WORKDIR /app

COPY . .

RUN chown -R user0001:user0001 /app

RUN npm install

USER user0001

CMD ["npm", "run", "start"]
