const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  engine: 'google-free',
  proxy: '',          // 如 http://127.0.0.1:7890
  targetLang: 'zh-CN',
  watchEnabled: true, // 自动划词（扩展轮询 PRIMARY），关闭则只响应热键
  apiKeys: {},
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2));
  return cache;
}

module.exports = { load, save };
