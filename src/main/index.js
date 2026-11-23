const { app, BrowserWindow, ipcMain, screen, Tray, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { translateWithFallback, engines } = require('./engines');
const settings = require('./settings');

function dlog(...args) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'debug.log'),
      new Date().toISOString() + ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ') + '\n');
  } catch {}
}

let popupWin = null;
let settingsWin = null;
let tray = null;
let triggerServer = null;

// ---------- 翻译弹窗 ----------
function createPopup() {
  popupWin = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  popupWin.loadFile(path.join(__dirname, '../renderer/popup.html'));
  popupWin.on('blur', () => { if (popupWin.isVisible()) popupWin.hide(); });
}

function showPopupAtCursor(text) {
  if (!popupWin) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const w = 420, h = 260;
  const p = screen.getCursorScreenPoint();
  popupWin.setPosition(Math.min(p.x + 12, width - w), Math.min(p.y + 12, height - h));
  popupWin.show();
  popupWin.webContents.send('translate-start', text);
}

// ---------- 托盘 ----------
function createTray() {
  tray = new Tray(nativeImageEmpty());
  tray.setToolTip('划词翻译');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '翻译剪贴板', click: () => {
      const t = clipboard.readText('clipboard');
      if (t.trim()) showPopupAtCursor(t.trim());
    } },
    { type: 'separator' },
    { label: '设置', click: () => createSettingsWindow() },
    { label: '退出', click: () => app.quit() },
  ]));
  tray.on('click', () => createSettingsWindow());
}

function nativeImageEmpty() {
  const { nativeImage } = require('electron');
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8//8/AzGAiShVowoJAgC2MwXXK8lx1gAAAABJRU5ErkJggg=='
  );
}

function createSettingsWindow() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 500,
    title: '设置',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  settingsWin.loadFile(path.join(__dirname, '../renderer/settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------- 本地触发服务 ----------
// GNOME 扩展把取到的文本放在 ?text= 里发过来；无 text 则翻译剪贴板。
// 仅绑定回环地址。watchEnabled 关闭时忽略扩展的自动划词。
function startTriggerServer() {
  triggerServer = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/translate') {
      let text = u.searchParams.get('text');
      dlog('触发: text参数 =', text ? JSON.stringify(text.slice(0, 40)) : '(无)');
      // 自动划词的开关在扩展侧 gsettings（应用保存时会同步过去），这里始终接受文本：
      // 热键与自动划词共用此入口，不应被 watchEnabled 拦截
      if (!text) {
        const t = clipboard.readText('clipboard').trim();
        if (t) { text = t; dlog('回退剪贴板:', JSON.stringify(t.slice(0, 40))); }
      }
      if (text) showPopupAtCursor(text);
      res.end('ok');
    } else if (u.pathname === '/ping') {
      res.end('pong');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  triggerServer.listen(19821, '127.0.0.1');
  triggerServer.on('error', (e) => console.warn('触发服务启动失败:', e.message));
}

async function applyProxy(proxy) {
  try {
    const { session } = require('electron');
    await session.defaultSession.setProxy({ mode: proxy ? 'fixed_servers' : 'system', rules: proxy || undefined });
  } catch {}
}

app.whenReady().then(async () => {
  const s = settings.load();
  await applyProxy(s.proxy);
  createPopup();
  createSettingsWindow();
  createTray();
  startTriggerServer();
});

app.on('window-all-closed', (e) => {/* 保持后台运行 */});
app.on('will-quit', () => { if (triggerServer) triggerServer.close(); });

// ---------- IPC ----------
ipcMain.handle('translate', (_e, { text, from, to }) => {
  const s = settings.load();
  return translateWithFallback(text, { from, to, settings: s });
});
ipcMain.handle('get-settings', () => settings.load());
ipcMain.handle('get-hotkey', () => {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    const dir = extensionSchemaDir();
    execFile('gsettings', ['get', 'org.gnome.shell.extensions.word-translator', 'translate-shortcut'],
      { env: { ...process.env, GSETTINGS_SCHEMA_DIR: dir } }, (err, stdout) => {
        // 输出形如 ['<Alt><Super>x']，转成 Alt+Super+X 展示
        const m = (stdout || '').match(/<([^>]+)>([^']+)/g) || [];
        if (!stdout || stdout.includes('@as')) return resolve('');
        let out = '';
        let mods = [];
        const letters = (stdout.match(/'([^']*)'/) || ['',''])[1];
        for (const part of letters.split('<').filter(Boolean)) {
          const p = part.replace('>', '');
          if (['Alt', 'Super', 'Control', 'Shift'].includes(p)) mods.push(p);
          else if (p) mods.push(p.toUpperCase().length === 1 ? p.toUpperCase() : p);
        }
        out = mods.join('+');
        resolve(out);
      });
  });
});
ipcMain.handle('set-hotkey', (_e, combo) => {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    // 严格校验：1-3 个修饰键 + 单个字母/数字，如 Alt+Super+X
    if (!/^((Control|Alt|Super|Shift)\+){1,3}[A-Z0-9]$/i.test(combo || '')) {
      return resolve({ ok: false, error: `格式无效: "${combo}"（需形如 Alt+Super+X）` });
    }
    const parts = combo.split('+').map((p) => p.trim());
    const mods = parts.slice(0, -1).map((m) => `<${m}>`).join('');
    const key = parts[parts.length - 1].toLowerCase();
    const gs = JSON.stringify([mods + key]);
    const dir = extensionSchemaDir();
    execFile('gsettings', ['set', 'org.gnome.shell.extensions.word-translator', 'translate-shortcut', gs],
      { env: { ...process.env, GSETTINGS_SCHEMA_DIR: dir } }, (err) => {
        if (err) return resolve({ ok: false, error: err.message });
        // 写后回读，确保落库的值有效
        execFile('gsettings', ['get', 'org.gnome.shell.extensions.word-translator', 'translate-shortcut'],
          { env: { ...process.env, GSETTINGS_SCHEMA_DIR: dir } }, (e2, stdout) => {
            const stored = (stdout || '').trim();
            resolve({ ok: !e2, error: e2?.message, stored });
          });
      });
  });
});
function extensionSchemaDir() {
  const os = require('os');
  return path.join(os.homedir(), '.local/share/gnome-shell/extensions/word-translator@local/schemas');
}

ipcMain.handle('save-settings', (_e, patch) => {
  const s = settings.save(patch);
  if (patch.proxy !== undefined) applyProxy(s.proxy);
  if (patch.watchEnabled !== undefined) syncExtensionWatch(s.watchEnabled);
  return s;
});

// 把应用的"自动划词"开关同步到扩展的 gsettings
function syncExtensionWatch(enabled) {
  const { execFile } = require('child_process');
  execFile('gsettings', ['set', 'org.gnome.shell.extensions.word-translator', 'watch-enabled', String(!!enabled)],
    { env: { ...process.env, GSETTINGS_SCHEMA_DIR: extensionSchemaDir() } }, () => {});
}
ipcMain.handle('list-engines', () => Object.values(engines).map(({ id, name, needsKey }) => ({ id, name, needsKey })));
ipcMain.handle('hide-popup', () => popupWin.hide());
ipcMain.handle('copy-result', (_e, text) => clipboard.writeText(text));
ipcMain.handle('open-settings', () => createSettingsWindow());
