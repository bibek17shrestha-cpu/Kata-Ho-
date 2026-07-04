const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function file(name) {
  return path.join(DATA_DIR, name);
}

function load(name) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf-8'));
  } catch (err) {
    return [];
  }
}

function save(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2));
}

module.exports = { load, save };
