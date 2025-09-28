#!/usr/bin/env node
// Normalize line endings of provided files to LF.
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node tools/convert-eol.js <files...>');
  process.exit(1);
}

let changed = 0;
for (const f of files) {
  try {
    const content = fs.readFileSync(f, 'utf8');
    const normalized = content.replace(/\r\n/g, '\n');
    if (normalized !== content) {
      fs.writeFileSync(f, normalized, 'utf8');
      console.log('Normalized LF:', f);
      changed++;
    } else {
      console.log('Already LF:', f);
    }
  } catch (e) {
    console.error('Error processing', f, e.message);
  }
}

if (changed) {
  console.log(`Converted ${changed} file(s) to LF.`);
} else {
  console.log('No files converted.');
}
