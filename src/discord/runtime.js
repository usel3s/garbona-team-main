let client = null;

function setDiscordClient(next) {
  client = next || null;
}

function getDiscordClient() {
  return client;
}

module.exports = { setDiscordClient, getDiscordClient };
