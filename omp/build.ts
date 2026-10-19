// Bundles src/host.ts and the shared modules it imports into dist/host.js, which package.json lists under
// omp.extensions. omp installs a marketplace plugin by copying only this folder, so the extension cannot import
// ../hooks at runtime. The bundle is committed, since an install runs no build. omp's own packages stay external,
// because omp supplies them to the extension.
//
//   bun build.ts          writes dist/host.js
//   bun build.ts --check  exits 1 when dist/host.js does not match the sources

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const output = join(here, 'dist', 'host.js')
const isCheck = process.argv[2] === '--check'

const result = await Bun.build({
  entrypoints: [join(here, 'src', 'host.ts')],
  target: 'bun',
  format: 'esm',
  external: ['@oh-my-pi/*'],
  banner: '// Built by omp/build.ts from omp/src and hooks/. Do not edit.',
})
if (!result.success) {
  for (const log of result.logs) console.error(String(log))
  process.exit(1)
}
const bundle = await result.outputs[0]!.text()

if (isCheck) {
  const current = await Bun.file(output)
    .text()
    .catch(() => null)
  if (current !== bundle) {
    console.error('Out of date: omp/dist/host.js. Run: bun --cwd omp run build')
    process.exit(1)
  }
} else {
  await Bun.write(output, bundle)
}
