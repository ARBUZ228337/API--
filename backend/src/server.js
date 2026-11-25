const { loadConfig } = require('./config');
const { createPostgresStore } = require('./store/postgres');
const { createApp } = require('./app');

const config = loadConfig();
const store = createPostgresStore(config.databaseUrl);
createApp({ store, config }).listen(config.port, () =>
  console.log(`API gateway listening on :${config.port}`));
