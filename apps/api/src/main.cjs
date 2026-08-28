const path = require('path');

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const { createServer } = require('./modules/api-console/infrastructure/http/api-console-server.cjs');
const { assertProductionSecrets } = require('./modules/api-console/infrastructure/security/production-secrets.cjs');

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';
assertProductionSecrets();

const port = Number(process.env.API_CONSOLE_PORT || 4274);
createServer().listen(port, () => {
  console.log(`API Console listening on http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/api/docs`);
});
