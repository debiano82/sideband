# Parse Dashboard ufficiale + polyfill di crypto.randomUUID (vedi il commento
# dentro randomuuid-polyfill.js): serve solo se apri il dashboard in HTTP su un
# host che non sia localhost. Con NPM e TLS davanti non cambia niente.
FROM parseplatform/parse-dashboard:latest

USER root
COPY randomuuid-polyfill.js /tmp/polyfill.js
# i bundle di ingresso: tutti gli altri chunk vengono caricati dopo
RUN cd /src/Parse-Dashboard/public/bundles && \
    for f in dashboard.bundle.js login.bundle.js; do \
      cat /tmp/polyfill.js "$f" > "$f.patched" && mv "$f.patched" "$f"; \
    done && \
    rm /tmp/polyfill.js && \
    chown -R node:node /src/Parse-Dashboard/public/bundles
USER node
