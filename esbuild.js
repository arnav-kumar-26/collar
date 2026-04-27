const esbuild = require('esbuild')

const isWatch = process.argv.includes('--watch')

const sharedConfig = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch,
}

// Extension host — runs in Node.js, must be CommonJS, vscode is external
const extensionConfig = {
  ...sharedConfig,
  entryPoints: ['src/extension.ts'],
  outfile: 'out/extension.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
}

// Sidebar — runs in the browser (webview), must be ESM/IIFE
const sidebarConfig = {
  ...sharedConfig,
  entryPoints: ['src/sidebar/index.tsx'],
  outfile: 'out/sidebar.js',
  platform: 'browser',
  format: 'iife',
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
  },
}

if (isWatch) {
  Promise.all([
    esbuild.context(extensionConfig).then(ctx => ctx.watch()),
    esbuild.context(sidebarConfig).then(ctx => ctx.watch()),
  ]).then(() => console.log('Watching for changes...'))
} else {
  Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(sidebarConfig),
  ]).then(() => console.log('Build complete'))
}
