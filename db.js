const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  posts: path.join(DATA_DIR, 'posts.json'),
  notifications: path.join(DATA_DIR, 'notifications.json'),
  pushSubscriptions: path.join(DATA_DIR, 'pushSubscriptions.json'),
};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const file of Object.values(FILES)) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
  }
}

function readData(name) {
  if (!FILES[name]) throw new Error(`Unknown data store: ${name}`);
  return JSON.parse(fs.readFileSync(FILES[name], 'utf-8'));
}

function writeData(name, data) {
  if (!FILES[name]) throw new Error(`Unknown data store: ${name}`);
  fs.writeFileSync(FILES[name], JSON.stringify(data, null, 2));
}

module.exports = { ensureDataFiles, readData, writeData };
