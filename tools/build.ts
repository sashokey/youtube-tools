import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { build } from 'esbuild';
import { minify } from 'terser';

const entry = new URL('../youtube-tools.src.ts', import.meta.url);
const source = await readFile(entry, 'utf8');
const header = source.match(/^\/\/ ==UserScript==\r?\n[\s\S]*?\/\/ ==\/UserScript==\r?\n/)?.[0];
if (!header) throw new Error('A complete userscript metadata block is required');
const result = await build({
  entryPoints: [fileURLToPath(entry)],
  bundle: true,
  format: 'iife',
  write: false,
  target: 'es2022',
  legalComments: 'none',
});
const bundle = result.outputFiles[0]?.text;
if (!bundle) throw new Error('The build produced no userscript');
const configs = [
  ['youtube-tools.user.js', { compress: { passes: 10 }, mangle: true }],
  ['youtube-tools.debug.js', { compress: false, mangle: false, format: { beautify: true } }],
] as const;
for (const [file, options] of configs) {
  const output = (await minify(bundle, options)).code;
  if (!output) throw new Error(`Minification produced no output for ${file}`);
  const contents = header + output + '\n';
  new Script(contents, { filename: file });
  const path = new URL(`../${file}`, import.meta.url);
  if (process.argv.includes('--check') && file === 'youtube-tools.user.js') {
    if (await readFile(path, 'utf8') !== contents) throw new Error('Regenerate youtube-tools.user.js with npm run build');
  } else {
    await writeFile(path, contents);
  }
}
