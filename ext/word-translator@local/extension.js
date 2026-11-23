// GNOME Shell 扩展：划词翻译的取词端（架构照搬 translate-indicator 的已验证模式）。
// - 全局热键 -> 读 PRIMARY 选区 -> 发给翻译应用
// - 自动划词 -> shell 内轮询 PRIMARY（无外部进程、无 surface、零干扰）-> 防抖去重后发送
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const POLL_MS = 600;
const QUIET_MS = 800;

export default class WordTranslatorExtension extends Extension {
  enable() {
    this._settings = this.getSettings('org.gnome.shell.extensions.word-translator');
    this._clipboard = St.Clipboard.get_default();

    // 热键
    this._settings.connect('changed::translate-shortcut', () => this._rebind());
    this._bind();

    // 自动划词轮询
    this._lastRaw = '';
    this._lastRawTime = 0;
    this._lastSent = '';
    this._pollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
      if (this._settings.get_boolean('watch-enabled')) this._pollPrimary();
      return GLib.SOURCE_CONTINUE;
    });
  }

  disable() {
    if (this._pollTimer) {
      GLib.source_remove(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._settings) {
      Main.wm.removeKeybinding('translate-shortcut');
      this._settings.run_dispose();
      this._settings = null;
    }
  }

  _bind() {
    Main.wm.addKeybinding(
      'translate-shortcut',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      this._trigger.bind(this)
    );
  }

  _rebind() {
    Main.wm.removeKeybinding('translate-shortcut');
    this._bind();
  }

  _pollPrimary() {
    this._clipboard.get_text(St.ClipboardType.PRIMARY, (_cb, text) => {
      if (!text) return;
      const t = text.trim();
      if (t.length < 2) return;          // 空选区/单字符忽略
      if (t !== this._lastRaw) {         // 拖选中，等静默
        this._lastRaw = t;
        this._lastRawTime = Date.now();
        return;
      }
      if (Date.now() - this._lastRawTime >= QUIET_MS && t !== this._lastSent) {
        this._lastSent = t;
        this._send(t);
      }
    });
  }

  _trigger() {
    // 热键：直读 PRIMARY（与 translate-indicator 相同路径）
    this._clipboard.get_text(St.ClipboardType.PRIMARY, (_cb, text) => {
      const t = (text || '').trim();
      if (t) this._send(t);
    });
  }

  _send(text) {
    const argv = ['curl', '-s', '-G', '--data-urlencode', `text=${text}`,
      '--max-time', '3', 'http://127.0.0.1:19821/translate'];
    try {
      GLib.spawn_async(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
    } catch (e) {
      console.warn('word-translator 发送失败:', e);
    }
  }
}
