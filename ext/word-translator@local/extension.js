// 划词翻译 GNOME 扩展（完整独立版）：取词 + 翻译 + 弹窗全部在 shell 内完成。
// - 自动划词：shell 内轮询 PRIMARY，防抖去重
// - 热键：直读 PRIMARY
// - 翻译：Gio.Subprocess 调 curl（google-free 端点，失败降级 transmart）
// - 弹窗：贴光标显示原文/译文，两个可编辑、可滚动的文本区；只有点击右侧关闭按钮才关闭
//   注意 1：St.Label 的 ellipsize 默认是 PANGO_ELLIPSIZE_END，不显式关掉长文本末尾会出现 “...”
//   注意 2：所有块高度都显式指定（滚动区固定高度），长内容滚动查看，绝不会溢出窗口
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const POLL_MS = 600;
const QUIET_MS = 800;

// 弹窗尺寸（可在扩展设置里改，运行时再按显示器尺寸收敛）
const POPUP_DEFAULT_W = 720;
const POPUP_DEFAULT_H = 560;
const POPUP_PAD_X = 14;
const POPUP_PAD_Y = 12;
const SCROLLBAR_W = 8; // 滚动条宽度占位
const TEXT_PAD = 6; // 文本区内边距
const HEADER_H = 20; // 标题栏（拖动区）高度
const GAP_AFTER_HEADER = 8;
const GAP_AFTER_ORIG = 10;
const SEP_H = 1;
const GAP_AFTER_SEP = 10;
const MIN_AREA_H = 40; // 每个文本区最小高度
const MIN_POPUP_W = 360; // 缩放到的最小内容宽度
const MIN_POPUP_H = 220; // 缩放到的总最小高度
const ORIG_HEIGHT_RATIO = 0.38; // 原文区最多占正文高度的比例
const POPUP_MAX_HEIGHT_RATIO = 0.8; // 弹窗最高占显示器高度的比例

// transmart 的语言码映射
const TRANSMART_LANG = { 'zh-CN': 'zh', en: 'en', ja: 'jp', ko: 'kr' };
// Google 失败后先让腾讯顶一会儿，冷却过了再试一次 Google：
// 代理/TUN 打开后最多等这么久就会自己切回 Google，被墙时又不用每次都白等超时
const GOOGLE_BACKOFF_MS = 5 * 60 * 1000;
const UA_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export default class WordTranslatorExtension extends Extension {
  enable() {
    this._settings = this.getSettings('org.gnome.shell.extensions.word-translator');
    this._clipboard = St.Clipboard.get_default();
    this._popup = null;
    this._translating = false;
    this._googleFailedAt = 0;
    // 信号登记表：_settingsConns 在 disable() 里断开，_popupConns 关弹窗时断开
    this._settingsConns = [];
    this._popupConns = [];

    this._track('_settingsConns', this._settings, 'changed::translate-shortcut', () => this._rebind());
    this._bind();

    this._lastRaw = '';
    this._lastRawTime = 0;
    this._lastSent = '';
    this._watchEnabled = this._settings.get_boolean('watch-enabled');
    this._track('_settingsConns', this._settings, 'changed::watch-enabled', () => this._updateWatch());
    // 代理或 key 一变，说明网络条件变了，立刻重新试 Google
    const resetGoogle = () => { this._googleFailedAt = 0; };
    this._track('_settingsConns', this._settings, 'changed::proxy', resetGoogle);
    this._track('_settingsConns', this._settings, 'changed::google-api-key', resetGoogle);
    if (this._watchEnabled) this._startPoll();
  }

  // connect 的同时登记，保证 disable()/关窗时能一一断开（审核要求）
  _track(bucket, target, signal, callback) {
    const id = target.connect(signal, callback);
    this[bucket].push({ target, id });
    return id;
  }

  _untrack(bucket) {
    for (const { target, id } of this[bucket]) {
      try {
        target.disconnect(id);
      } catch (e) {
        // 对象已经被销毁，信号随对象一起没了
      }
    }
    this[bucket] = [];
  }

  _startPoll() {
    if (this._pollTimer) return;
    this._pollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
      this._pollPrimary();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _stopPoll() {
    if (this._pollTimer) {
      GLib.source_remove(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _updateWatch() {
    this._watchEnabled = this._settings.get_boolean('watch-enabled');
    if (this._watchEnabled) this._startPoll();
    else this._stopPoll();
  }

  disable() {
    this._stopPoll();
    this._closePopup();
    this._untrack('_settingsConns');
    if (this._settings) {
      Main.wm.removeKeybinding('translate-shortcut');
      this._settings = null;
    }
    this._settingsConns = null;
    this._popupConns = null;
    this._clipboard = null;
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

  // ---- 取词 ----
  _pollPrimary() {
    this._clipboard.get_text(St.ClipboardType.PRIMARY, (_cb, text) => {
      if (!text) return;
      const t = text.trim();
      if (t.length < 2) return;
      if (t !== this._lastRaw) {
        this._lastRaw = t;
        this._lastRawTime = Date.now();
        return;
      }
      if (Date.now() - this._lastRawTime >= QUIET_MS && t !== this._lastSent) {
        this._lastSent = t;
        this._translateAndShow(t);
      }
    });
  }

  _trigger() {
    this._clipboard.get_text(St.ClipboardType.PRIMARY, (_cb, text) => {
      const t = (text || '').trim();
      if (t) this._translateAndShow(t);
    });
  }

  // ---- 翻译 ----
  _exec(argv) {
    return new Promise((resolve, reject) => {
      try {
        const proc = new Gio.Subprocess({
          argv,
          flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (p, res) => {
          try {
            const [, stdout, stderr] = p.communicate_utf8_finish(res);
            const status = p.get_exit_status();
            if (status !== 0) {
              const err = new Error((stderr || '').trim().slice(0, 160) || `curl 退出码 ${status}`);
              err.exitCode = status;
              reject(err);
            } else {
              resolve(stdout);
            }
          } catch (e) {
            reject(e);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // transmart 自 2024 年起要求 client_key，旧的 session 写法会返回 ret_code: Session-Out
  _clientKey() {
    return `browser-chrome-125.0.0.0-${Date.now() * 1000}-${Math.floor(Math.random() * 1e10)}`;
  }

  // 代理：扩展设置里填的优先；没填就看 GNOME 的「网络代理（手动）」。
  // curl 不读 gsettings，所以这里自己把系统代理翻成 -x 参数。
  _proxyArgs() {
    const own = (this._settings.get_string('proxy') || '').trim();
    if (own) return ['-x', own];

    try {
      const sys = new Gio.Settings({ schema_id: 'org.gnome.system.proxy' });
      if (sys.get_string('mode') === 'manual') {
        const https = new Gio.Settings({ schema_id: 'org.gnome.system.proxy.https' });
        const host = https.get_string('host');
        const port = https.get_int('port');
        if (host && port > 0) return ['-x', `http://${host}:${port}`];
      }
    } catch (e) {
      // 没有这个 schema 就当没配代理
    }
    return [];
  }

  async _translateGoogle(text, to, proxyArgs) {
    const key = (this._settings.get_string('google-api-key') || '').trim();

    // 有官方 API key 就走官方接口：稳定，不会被风控
    if (key) {
      const out = await this._exec([
        'curl', '-s', '-G', ...proxyArgs, '-A', UA_CHROME, '--max-time', '8',
        '--data-urlencode', `q=${text}`,
        '--data-urlencode', `target=${to}`,
        '--data-urlencode', `key=${key}`,
        'https://translation.googleapis.com/language/translate/v2',
      ]);
      if (/^\s*</.test(out)) throw new Error('官方接口返回网页，检查代理或网络');
      const data = JSON.parse(out);
      const tr = data && data.data && data.data.translations && data.data.translations[0];
      if (!tr || !tr.translatedText) {
        const msg = data && data.error && data.error.message ? data.error.message : '响应格式变化';
        throw new Error(`官方接口：${msg}`);
      }
      return tr.translatedText;
    }

    // 没有 key 就用免费的网页接口
    const out = await this._exec([
      'curl', '-s', '-G', ...proxyArgs, '-A', UA_CHROME, '--max-time', '3',
      '--data-urlencode', `q=${text}`,
      'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto',
      '--data-urlencode', `tl=${to}`,
    ]);
    if (/^\s*</.test(out)) {
      throw new Error(proxyArgs.length
        ? '返回了风控页（代理出口 IP 被 Google 拦，可在设置里填官方 API key）'
        : '返回了风控页（先配代理，或填官方 API key）');
    }
    const data = JSON.parse(out);
    if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('响应格式变化');
    return data[0][0];
  }

  // 腾讯不打代理：它是国内直连，走代理反而更容易失败
  async _translateTencent(text, to) {
    const body = JSON.stringify({
      header: { fn: 'auto_translation', client_key: this._clientKey() },
      type: 'plain',
      model_category: 'normal',
      source: { lang: 'auto', text_list: [text] },
      target: { lang: TRANSMART_LANG[to] || 'zh' },
    });
    const request = async insecure => this._exec([
      'curl', '-s', ...(insecure ? ['-k'] : []), '--max-time', '8', '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-H', 'Origin: https://transmart.qq.com',
      '-H', 'Referer: https://transmart.qq.com/',
      '-d', body,
      'https://transmart.qq.com/api/imt',
    ]);

    let out;
    try {
      out = await request(false);
    } catch (e) {
      // 60 = 服务端证书校验失败。transmart 的证书 2026-10-11 就过期了，
      // 只对这一个接口退让：拿到的仍然只是译文，不涉及任何凭证。
      if (e.exitCode !== 60) throw e;
      console.warn('word-translator: transmart 证书校验失败，改用 -k 重试');
      out = await request(true);
    }
    const data = JSON.parse(out);
    const t = data && data.auto_translation;
    if (Array.isArray(t) && t.length) return t.join('');
    if (typeof t === 'string' && t) return t;
    if (data && data.header && data.header.ret_code && data.header.ret_code !== 'succ')
      throw new Error(`ret_code=${data.header.ret_code}`);
    throw new Error('响应格式变化');
  }

  async _translate(text) {
    const to = this._settings.get_string('target-lang') || 'zh-CN';
    const proxyArgs = this._proxyArgs();

    const google = { name: 'Google', run: () => this._translateGoogle(text, to, proxyArgs) };
    const tencent = { name: '腾讯', run: () => this._translateTencent(text, to) };

    // Google 冷却期内先走腾讯；冷却结束 Google 自动回到第一顺位，
    // 所以代理一开、最多等一个冷却周期，就会重新请求 Google
    const cooling = this._googleFailedAt && Date.now() - this._googleFailedAt < GOOGLE_BACKOFF_MS;
    const engines = cooling ? [tencent, google] : [google, tencent];

    const errors = [];
    for (const engine of engines) {
      try {
        const out = await engine.run();
        if (out) {
          if (engine === google) this._googleFailedAt = 0;
          return { text: out, engine: engine.name };
        }
        throw new Error('空结果');
      } catch (e) {
        if (engine === google) this._googleFailedAt = Date.now();
        errors.push(`${engine.name} ${e.message}`);
        console.warn(`word-translator: ${engine.name} 失败`, e.message);
      }
    }
    throw new Error(errors.join('；'));
  }

  async _translateAndShow(text) {
    if (this._translating) return;
    this._translating = true;
    const [x, y] = global.get_pointer();
    // 先把窗口弹出来（译文占位），网络慢或失败时也不会“按了没反应”
    this._showPopup(text, '翻译中…', '…', x, y);
    try {
      const r = await this._translate(text);
      this._updateTranslation(r.text, r.engine);
    } catch (e) {
      console.warn('word-translator 翻译失败:', e.message);
      this._updateTranslation(`翻译失败：${e.message}\n\n检查一下网络；连不上 Google 的话在扩展设置里填代理。`, 'error');
    } finally {
      this._translating = false;
    }
  }

  // 翻译回来后只换文字，窗口不再重建（否则会跳位置）
  _updateTranslation(text, engine) {
    if (!this._popup || !this._parts) return;
    this._parts.transLabel.set_text(text);
    this._parts.title.set_text('划词翻译 · ' + engine);
    if (this._size) this._applyLayout(this._size.width, this._size.height);
  }

  // ---- 弹窗 ----
  _closePopup() {
    this._drag = null;
    this._scrollAreas = [];
    this._parts = null;
    this._untrack('_popupConns');
    if (this._popup) {
      this._popup.destroy();
      this._popup = null;
    }
  }

  _monitorAt(px, py) {
    for (const m of Main.layoutManager.monitors) {
      if (px >= m.x && px < m.x + m.width && py >= m.y && py < m.y + m.height) return m;
    }
    return Main.layoutManager.primaryMonitor;
  }

  _workArea(m) {
    try {
      return Main.layoutManager.getWorkAreaForMonitor(m.index);
    } catch (e) {
      return { x: m.x, y: m.y, width: m.width, height: m.height };
    }
  }

  // 可编辑 + 可选中 + 自动换行 + 不省略
  _editableLabel(text, style, width) {
    const label = new St.Label({ text, style, reactive: true });
    const ct = label.clutter_text;
    ct.line_wrap = true;
    ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    // St.Label 默认 ellipsize = END，会把放不下的文字变成 “...”
    ct.ellipsize = Pango.EllipsizeMode.NONE;
    ct.selectable = true;
    ct.editable = true;
    ct.reactive = true;
    // 默认选中是白底，而正文颜色是浅色 #eee —— 选中后字直接看不见，显式给一套对比色
    ct.selection_color = new Clutter.Color({ red: 53, green: 132, blue: 228, alpha: 255 });
    ct.selected_text_color = new Clutter.Color({ red: 255, green: 255, blue: 255, alpha: 255 });
    // 点一下就能直接编辑/选中（不依赖 ClutterText 自己抢焦点）
    this._track('_popupConns', ct, 'button-press-event', () => {
      ct.grab_key_focus();
      return Clutter.EVENT_PROPAGATE;
    });
    // GNOME 46 的 ClutterText 只实现了 Ctrl+A，没有剪贴板操作，Ctrl+C 得自己做
    this._track('_popupConns', ct, 'key-press-event', (actor, event) => this._onTextKeyPress(ct, event));
    if (width > 0) label.set_width(width);
    return label;
  }

  // 固定尺寸的滚动区（GNOME 46 的 StScrollView 只接受 StScrollable 子节点，
  // 直接放 St.Label 不会被布局，必须套一层 St.BoxLayout）
  // 文本区快捷键：Ctrl+C 复制选中内容（Ctrl+A 由 ClutterText 自带）
  _onTextKeyPress(ct, event) {
    const state = event.get_state();
    if (!(state & Clutter.ModifierType.CONTROL_MASK)) return Clutter.EVENT_PROPAGATE;
    const sym = event.get_key_symbol();
    if (sym !== Clutter.KEY_c && sym !== Clutter.KEY_C) return Clutter.EVENT_PROPAGATE;

    const text = ct.get_selection();
    if (!text) return Clutter.EVENT_STOP;
    try {
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
    } catch (e) {
      console.warn('word-translator: 复制失败', e.message);
    }
    return Clutter.EVENT_STOP;
  }

  _scrollArea(label, width, height) {
    const box = new St.BoxLayout({ vertical: true, x_expand: true });
    box.add_child(label);
    const scroll = new St.ScrollView({
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
      x_expand: true,
      y_expand: false,
      style_class: 'vfade',
      style: `padding: ${TEXT_PAD}px; border-radius: 6px; background-color: rgba(0,0,0,0.22);`,
    });
    scroll.add_child(box);
    scroll.set_width(width);
    scroll.set_height(height);
    return scroll;
  }

  _popupStyle(width) {
    return 'background-color: rgba(32,32,36,0.97); border-radius: 10px;'
      + ' border: 1px solid rgba(255,255,255,0.12);'
      + ` padding: ${POPUP_PAD_Y}px ${POPUP_PAD_X}px; color: #eee;`
      + ` width: ${width}px;`;
  }

  _titleButton(iconName, onClick) {
    const btn = new St.Button({
      child: new St.Icon({ icon_name: iconName, icon_size: 14 }),
      style: 'padding: 2px 4px; border-radius: 4px; margin-left: 2px;',
      can_focus: true,
      track_hover: true,
    });
    this._track('_popupConns', btn, 'clicked', onClick);
    return btn;
  }

  _showPopup(original, translated, engine, px, py) {
    this._closePopup();

    const monitor = this._monitorAt(px, py);
    const wantW = this._settings.get_int('popup-width') || POPUP_DEFAULT_W;
    const wantH = this._settings.get_int('popup-height') || POPUP_DEFAULT_H;
    const width = Math.max(MIN_POPUP_W, Math.min(wantW, monitor.width - 32));
    const height = Math.max(MIN_POPUP_H, Math.min(wantH, Math.round(monitor.height * POPUP_MAX_HEIGHT_RATIO)));

    const root = new St.BoxLayout({ vertical: true, style: this._popupStyle(width) });

    // 标题栏：标题 + 提示 + 最小化 / 最大化 / 关闭
    const header = new St.BoxLayout({ style: `height: ${HEADER_H}px;` });
    const title = new St.Label({
      text: '划词翻译 · ' + engine,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
      style: 'font-size: 11px; color: #8ab4f8;',
    });
    title.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    header.add_child(title);

    const hint = new St.Label({
      text: '按住标题拖动',
      y_align: Clutter.ActorAlign.CENTER,
      style: 'font-size: 10px; color: #6f6f78; margin-right: 6px;',
    });
    header.add_child(hint);

    const minBtn = this._titleButton('window-minimize-symbolic', () => this._toggleMinimize());
    const maxBtn = this._titleButton('window-maximize-symbolic', () => this._toggleMaximize());
    const closeBtn = this._titleButton('window-close-symbolic', () => this._closePopup());
    header.add_child(minBtn);
    header.add_child(maxBtn);
    header.add_child(closeBtn);

    root.add_child(header);
    const gap1 = new St.Widget({ style: `height: ${GAP_AFTER_HEADER}px;` });
    root.add_child(gap1);

    // 原文（可编辑、可滚动）
    const origLabel = this._editableLabel(original, 'font-size: 12px; color: #bbb;', 0);
    const origScroll = this._scrollArea(origLabel, width, MIN_AREA_H);
    root.add_child(origScroll);

    const gap2 = new St.Widget({ style: `height: ${GAP_AFTER_ORIG}px;` });
    const sep = new St.Widget({ style: `background-color: rgba(255,255,255,0.12); height: ${SEP_H}px;` });
    const gap3 = new St.Widget({ style: `height: ${GAP_AFTER_SEP}px;` });
    root.add_child(gap2);
    root.add_child(sep);
    root.add_child(gap3);

    // 译文（可编辑、可滚动）
    const transLabel = this._editableLabel(translated, 'font-size: 16px; color: #fff;', 0);
    const transScroll = this._scrollArea(transLabel, width, MIN_AREA_H);
    root.add_child(transScroll);

    this._popup = root;
    this._monitor = monitor;
    this._parts = {
      header, title, hint, minBtn, maxBtn, closeBtn,
      origLabel, origScroll, transLabel, transScroll,
      body: [gap1, origScroll, gap2, sep, gap3, transScroll],
    };
    this._scrollAreas = [origScroll, transScroll];
    this._headerButtons = [minBtn, maxBtn, closeBtn];
    this._maximized = false;
    this._minimized = false;
    this._restoreBox = null;
    this._size = { width, height };

    // 点击弹窗本体不再关闭窗口
    root.reactive = true;
    Main.layoutManager.addTopChrome(root);

    this._applyLayout(width, height);

    const rootW = root.get_preferred_width(-1)[1];
    const rootH = root.get_preferred_height(width)[1];

    let x = px + 16;
    let y = py + 16;
    if (x + rootW > monitor.x + monitor.width) x = px - rootW - 16;
    if (y + rootH > monitor.y + monitor.height) y = Math.max(monitor.y + 8, monitor.y + monitor.height - rootH - 8);
    x = Math.max(monitor.x + 8, x);
    y = Math.max(monitor.y + 8, y);
    root.set_position(Math.round(x), Math.round(y));

    this._attachDrag(root);
  }

  // width = 内容宽度（CSS width），height = 弹窗总高（不含 1px 边框）
  _applyLayout(width, height) {
    const root = this._popup;
    if (!root || !this._parts) return;

    const contentH = height - POPUP_PAD_Y * 2;
    const bodyH = contentH - HEADER_H - GAP_AFTER_HEADER - GAP_AFTER_ORIG - SEP_H - GAP_AFTER_SEP;
    const textW = Math.max(120, width - TEXT_PAD * 2 - SCROLLBAR_W);
    const { origLabel, origScroll, transLabel, transScroll } = this._parts;

    root.style = this._popupStyle(width);

    origLabel.set_width(textW);
    transLabel.set_width(textW);

    const [, origNatH] = origLabel.get_preferred_height(textW);
    const origH = Math.max(MIN_AREA_H, Math.min(Math.round(bodyH * ORIG_HEIGHT_RATIO), Math.ceil(origNatH)));
    const transH = Math.max(MIN_AREA_H, bodyH - origH);

    origScroll.set_width(width);
    origScroll.set_height(origH);
    transScroll.set_width(width);
    transScroll.set_height(transH);

    this._size = { width, height };
  }

  _updateTitleButtons() {
    if (!this._parts) return;
    this._parts.minBtn.child.icon_name = this._minimized ? 'pan-up-symbolic' : 'window-minimize-symbolic';
    this._parts.maxBtn.child.icon_name = this._maximized ? 'window-restore-symbolic' : 'window-maximize-symbolic';
  }

  // 最小化 = 折叠成只剩标题栏，再点展开
  _toggleMinimize() {
    if (!this._popup || !this._parts) return;
    this._minimized = !this._minimized;
    for (const actor of this._parts.body) actor.visible = !this._minimized;
    this._updateTitleButtons();
  }

  // 最大化 = 铺满当前显示器工作区，再点还原
  _toggleMaximize() {
    if (!this._popup || !this._parts) return;
    const m = this._monitor || Main.layoutManager.primaryMonitor;
    const wa = this._workArea(m);

    // 折叠状态下点最大化，先展开内容
    if (this._minimized) {
      this._minimized = false;
      for (const actor of this._parts.body) actor.visible = true;
    }

    if (!this._maximized) {
      this._restoreBox = {
        size: { ...this._size },
        pos: this._popup.get_position(),
      };
      const w = wa.width - 16 - POPUP_PAD_X * 2 - 2;
      const h = wa.height - 18;
      this._applyLayout(w, h);
      this._popup.set_position(wa.x + 8, wa.y + 8);
      this._maximized = true;
    } else {
      this._applyLayout(this._restoreBox.size.width, this._restoreBox.size.height);
      this._popup.set_position(this._restoreBox.pos[0], this._restoreBox.pos[1]);
      this._maximized = false;
    }
    this._updateTitleButtons();
  }

  // ---- 拖动 ----
  // 用 captured-event，子组件不会把事件吞掉。标题栏/内边距可拖；
  // 文本区留给选中/编辑，按钮和滚动条不参与拖动。
  _attachDrag(root) {
    this._track('_popupConns', root, 'captured-event', (actor, event) => this._onPopupEvent(actor, event));
    this._track('_popupConns', global.stage, 'captured-event', (stage, event) => this._onStageEvent(stage, event));
  }

  _isTitleButton(source) {
    if (!source) return false;
    for (const b of this._headerButtons || []) {
      if (source === b || b.contains(source)) return true;
    }
    return false;
  }

  _isTextArea(source) {
    if (!source || !this._parts) return false;
    for (const a of [this._parts.origLabel, this._parts.origScroll,
                     this._parts.transLabel, this._parts.transScroll]) {
      if (a && (source === a || a.contains(source))) return true;
    }
    return false;
  }

  // 滚动条区域不参与窗口拖动：按坐标判断（滚动条 actor 的 size 取不到，直接算文本区右侧那条带）
  _pointInScrollBar(px, py) {
    const strip = TEXT_PAD + SCROLLBAR_W + 4;
    for (const sv of this._scrollAreas || []) {
      if (!sv) continue;
      const [sx, sy] = sv.get_transformed_position();
      const w = sv.get_width();
      const h = sv.get_height();
      if (w <= 0 || h <= 0) continue;
      if (px >= sx + w - strip && px <= sx + w && py >= sy && py <= sy + h) return true;
    }
    return false;
  }

  // 实测 GNOME 46 里真实 BUTTON_PRESS 事件的 get_source() 是 null，
  // 必须按坐标自己做命中测试，否则永远判定“没按在弹窗上”而不拖动。
  _actorAt(px, py, event) {
    let src = null;
    try {
      src = event.get_source();
    } catch (e) {
      src = null;
    }
    if (src) return src;
    try {
      return global.stage.get_actor_at_pos(Clutter.PickMode.ALL, Math.round(px), Math.round(py));
    } catch (e) {
      return null;
    }
  }

  _onPopupEvent(actor, event) {
    const type = event.type();

    if (type === Clutter.EventType.BUTTON_PRESS) {
      if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
      const [px, py] = event.get_coords();
      const source = this._actorAt(px, py, event);

      // 标题栏按钮交给按钮自己处理
      if (this._isTitleButton(source)) return Clutter.EVENT_PROPAGATE;

      // 文本区按下交给文本自己：点击定位光标、拖动选中、Ctrl+C 复制
      if (this._isTextArea(source)) return Clutter.EVENT_PROPAGATE;

      if (this._pointInScrollBar(px, py)) return Clutter.EVENT_PROPAGATE;
      for (let a = source; a && a !== actor; a = a.get_parent()) {
        if (a.constructor.name === 'St_ScrollBar') return Clutter.EVENT_PROPAGATE;
      }

      const [ax, ay] = actor.get_position();
      this._drag = { ax, ay, px, py, moved: false };
      return Clutter.EVENT_PROPAGATE;
    }

    return Clutter.EVENT_PROPAGATE;
  }

  // 拖动期间直接在 stage 上收事件：指针跑到弹窗外面也不会丢。
  _onStageEvent(stage, event) {
    if (!this._popup) {
      this._drag = null;
      return Clutter.EVENT_PROPAGATE;
    }
    const type = event.type();

    if (this._drag) {
      if (type === Clutter.EventType.MOTION) {
        const d = this._drag;
        const [px, py] = event.get_coords();
        // 3px 阈值：普通点击/轻微抖动不会把窗口挪走
        if (!d.moved) {
          if (Math.abs(px - d.px) < 3 && Math.abs(py - d.py) < 3) return Clutter.EVENT_PROPAGATE;
          d.moved = true;
        }
        this._popup.set_position(Math.round(d.ax + px - d.px), Math.round(d.ay + py - d.py));
        return Clutter.EVENT_STOP;
      }
      if (type === Clutter.EventType.BUTTON_RELEASE) {
        if (this._drag.moved) this._clampPopup(this._popup);
        this._drag = null;
        return Clutter.EVENT_PROPAGATE;
      }
    }

    return Clutter.EVENT_PROPAGATE;
  }

  // 拖完别把窗口拖丢：至少留一部分在屏幕里
  _clampPopup(actor) {
    const [w, h] = actor.get_size();
    const [x, y] = actor.get_position();
    const m = this._monitorAt(Math.round(x + w / 2), Math.round(y + h / 2));
    const keep = 80;
    const nx = Math.min(Math.max(x, m.x - w + keep), m.x + m.width - keep);
    const ny = Math.min(Math.max(y, m.y), m.y + m.height - 40);
    if (nx !== x || ny !== y) actor.set_position(Math.round(nx), Math.round(ny));
  }
}
