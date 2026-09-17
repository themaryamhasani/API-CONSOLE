'use strict';

/**
 * Save / load API + web image tarball (cross-platform; no shell ${VAR:-} expansion).
 * Usage:
 *   node scripts/docker-images.cjs save
 *   node scripts/docker-images.cjs load
 *   npm run images:save | npm run images:load
 */

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const action = String(process.argv[2] || '').toLowerCase();
const tarPath = process.env.API_CONSOLE_IMAGES_TAR || path.join(root, 'api-console-images.tar');
const apiImage = process.env.API_IMAGE || 'api-console-api:latest';
const webImage = process.env.WEB_IMAGE || 'api-console-web:latest';

function run(args) {
  console.log(`[images] docker ${args.join(' ')}`);
  const result = spawnSync('docker', args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error(`[images] ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (action === 'save') {
  run(['save', '-o', tarPath, apiImage, webImage]);
  console.log(`[images] saved ${tarPath}`);
} else if (action === 'load') {
  run(['load', '-i', tarPath]);
  console.log(`[images] loaded ${tarPath}`);
} else {
  console.error('Usage: node scripts/docker-images.cjs <save|load>');
  process.exit(1);
}
