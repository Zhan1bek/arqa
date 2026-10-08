// PostToolUse hook: formats the file Claude just edited, so diffs carry no formatting noise.
// Reads the hook payload from stdin; never fails the tool call (formatting is best-effort).
import { spawnSync } from 'node:child_process';

const FORMATTABLE = /\.(ts|tsx|js|mjs|json|md|ya?ml)$/;

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  try {
    const filePath = JSON.parse(raw)?.tool_input?.file_path;
    if (typeof filePath === 'string' && FORMATTABLE.test(filePath)) {
      spawnSync('npx', ['prettier', '--write', '--log-level=warn', filePath], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
    }
  } catch {
    // Malformed payload — nothing to format.
  }
  process.exit(0);
});
