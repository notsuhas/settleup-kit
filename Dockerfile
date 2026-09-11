# The MCP server over HTTP, for running it somewhere other than your laptop.
#
# Published to npm, so there is nothing to build here — which also means this
# image does not need git, a compiler, or the source tree.
FROM node:24-slim

ARG VERSION=0.1.0
RUN npm install -g "@notsuhas/settleup-kit@${VERSION}" && rm -rf ~/.npm/_cacache

# Where the token cache lives. Mounting a volume over it saves a sign-in on
# every restart; unlike some services there is no device budget to protect.
ENV SETTLEUP_CONFIG_DIR=/config
RUN mkdir -p /config && chown node:node /config
VOLUME ["/config"]

USER node
EXPOSE 8791

# The server refuses to start without MCP_TOKEN, so there is no unauthenticated
# default to forget about. GET /health is unauthenticated and returns only "ok".
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||8791)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["settleup-mcp-http"]
