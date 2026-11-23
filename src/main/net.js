// Electron main 进程优先用 net.fetch（走 Chromium 网络栈，自动跟随 session 代理设置）；
// 在纯 Node 环境测试时回退到全局 fetch。
let _fetch = globalThis.fetch;
let _headersCtor = globalThis.Headers;
try {
  const { net } = require('electron');
  if (net && net.fetch) { _fetch = net.fetch; _headersCtor = net.Headers || globalThis.Headers; }
} catch {}

async function request(url, options = {}, { timeout = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await _fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { request };
