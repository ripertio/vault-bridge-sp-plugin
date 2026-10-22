#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');
const archiver = require('archiver');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'manifest.json'), 'utf8'));
const VERSION = MANIFEST.version;

async function buildPlugin() {
  console.log('Building Vault Bridge with esbuild...');

  // Clean dist directory
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR);

  try {
    // Build the background script
    console.log('Building plugin.js...');
    await build({
      entryPoints: [path.join(SRC_DIR, 'background/background.ts')],
      bundle: true,
      outfile: path.join(DIST_DIR, 'plugin.js'),
      platform: 'browser',
      target: 'es2020',
      format: 'iife',
      globalName: 'VaultBridgePlugin',
      define: {
        'process.env.NODE_ENV': '"production"',
        // Inject the manifest version into the background bundle too (the config
        // panel gets it via the index.html placeholder). Used by the self-update
        // notifier to compare against the latest release.
        __PLUGIN_VERSION__: JSON.stringify(VERSION),
      },
      banner: {
        js: `// Vault Bridge v${VERSION}\n// This file is auto-generated. Do not edit directly.`,
      },
      external: ['fs', 'path', 'child_process', '@super-productivity/plugin-api'],
      logLevel: 'info',
      minify: true,
      sourcemap: false,
    });

    // Copy index.html, injecting the version from the manifest so the config
    // panel footer always matches the released version (placeholder: __PLUGIN_VERSION__).
    console.log('Copying index.html...');
    const indexHtml = fs
      .readFileSync(path.join(SRC_DIR, 'ui', 'index.html'), 'utf8')
      .replace(/__PLUGIN_VERSION__/g, VERSION);
    fs.writeFileSync(path.join(DIST_DIR, 'index.html'), indexHtml);

    // Copy manifest.json
    console.log('Copying manifest.json...');
    fs.copyFileSync(
      path.join(SRC_DIR, 'manifest.json'),
      path.join(DIST_DIR, 'manifest.json'),
    );

    // Copy or create icon.svg
    console.log('Copying icon.svg...');
    const iconPath = path.join(SRC_DIR, 'assets', 'icon_2.svg');
    if (fs.existsSync(iconPath)) {
      fs.copyFileSync(iconPath, path.join(DIST_DIR, 'icon.svg'));
    } else {
      // Create a simple default icon if not exists
      const defaultIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="9" y1="15" x2="15" y2="15"/>
</svg>`;
      fs.writeFileSync(path.join(DIST_DIR, 'icon.svg'), defaultIcon);
    }
    console.log('\nBuild complete! Output in dist/');

    // Create installable ZIP
    await createZip();
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

async function createZip() {
  const zipName = `vault-bridge-v${VERSION}.zip`;
  const zipPath = path.join(ROOT_DIR, zipName);

  // Remove previous zip if exists
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  return new Promise((resolve, reject) => {
    console.log(`\nCreating ${zipName}...`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const kb = (archive.pointer() / 1024).toFixed(1);
      console.log(`✅ ${zipName} created (${kb} KB)`);
      console.log(`   Install via Super Productivity → Plugins → Install from ZIP`);
      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);

    // Add all files from dist/ to the root of the zip (no subfolder)
    archive.directory(DIST_DIR, false);
    archive.finalize();
  });
}

// Run the build
buildPlugin();
