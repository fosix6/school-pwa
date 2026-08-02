// scripts/build.js
const fs = require('fs');
const path = require('path');

// Read the secret from environment
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
if (!APPS_SCRIPT_URL) {
    console.error('❌ APPS_SCRIPT_URL environment variable not set');
    console.error('   Make sure it\'s set in GitHub Secrets or your .env file');
    process.exit(1);
}

console.log('🔨 Building with API URL:', APPS_SCRIPT_URL);

// Ensure dist directory exists
const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Files to process
const files = [
    { src: 'src/index.html', dest: 'dist/index.html' },
    { src: 'src/style.css', dest: 'dist/style.css' },
    { src: 'src/app.js', dest: 'dist/app.js' },
    { src: 'src/sw.js', dest: 'dist/sw.js' },
    { src: 'src/manifest.json', dest: 'dist/manifest.json' },
];

// Copy and process each file
for (const file of files) {
    const srcPath = path.join(__dirname, '..', file.src);
    const destPath = path.join(__dirname, '..', file.dest);
    
    if (!fs.existsSync(srcPath)) {
        console.warn(`⚠️  Source file not found: ${file.src}`);
        continue;
    }
    
    let content = fs.readFileSync(srcPath, 'utf8');
    
    // Replace placeholder with actual URL
    content = content.replace(/\{\{APPS_SCRIPT_URL\}\}/g, APPS_SCRIPT_URL);
    
    fs.writeFileSync(destPath, content);
    console.log(`✅ Built: ${file.dest}`);
}

console.log('🎉 Build complete!');
console.log(`📁 Output directory: ${distDir}`);