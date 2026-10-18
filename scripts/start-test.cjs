const { spawn } = require('node:child_process');
const path = require('node:path');

const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');
const child = spawn(process.execPath, [cli, 'start', '--dev-client', '--tunnel=ngrok', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_TEST_TOOLS: 'true' },
});
child.on('error', () => { console.error('Unable to start Expo test server.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
