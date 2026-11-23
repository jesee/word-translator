// 扩展设置界面（GNOME「扩展」App 里点齿轮打开）
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WordTranslatorPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings('org.gnome.shell.extensions.word-translator');

    const page = new Adw.PreferencesPage();
    window.add(page);

    // 弹窗尺寸
    const popupGroup = new Adw.PreferencesGroup({ title: '弹窗' });
    page.add(popupGroup);

    const addSizeRow = (title, key, lower, upper, step) => {
      const row = new Adw.SpinRow({
        title,
        adjustment: new Gtk.Adjustment({
          lower,
          upper,
          step_increment: step,
          value: settings.get_int(key),
        }),
      });
      row.connect('notify::value', () => {
        const v = Math.round(row.get_value());
        if (v !== settings.get_int(key)) settings.set_int(key, v);
      });
      popupGroup.add(row);
    };

    addSizeRow('宽度（px）', 'popup-width', 360, 1600, 20);
    addSizeRow('高度（px）', 'popup-height', 240, 1200, 20);

    // 翻译组
    const trGroup = new Adw.PreferencesGroup({ title: '翻译' });
    page.add(trGroup);

    const langRow = new Adw.ActionRow({ title: '目标语言' });
    const langCombo = new Gtk.ComboBoxText({ valign: Gtk.Align.CENTER });
    for (const [v, label] of [['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어']]) {
      langCombo.append(v, label);
    }
    langCombo.active_id = settings.get_string('target-lang');
    langRow.add_suffix(langCombo);
    langRow.activatable_widget = langCombo;
    langCombo.connect('changed', (c) => settings.set_string('target-lang', c.active_id || 'zh-CN'));
    trGroup.add(langRow);

    const proxyRow = new Adw.ActionRow({
      title: '代理地址',
      subtitle: '如 http://127.0.0.1:7897；留空则自动跟随 GNOME 系统代理。填了 Google 会排第一顺位',
    });
    const proxyEntry = new Gtk.Entry({
      text: settings.get_string('proxy'),
      valign: Gtk.Align.CENTER,
      width_chars: 26,
      placeholder_text: '留空不使用',
    });
    proxyRow.add_suffix(proxyEntry);
    proxyRow.activatable_widget = proxyEntry;
    let saveTimer = null;
    proxyEntry.connect('changed', () => {
      if (saveTimer) GLib.source_remove(saveTimer);
      saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
        settings.set_string('proxy', proxyEntry.get_text().trim());
        saveTimer = null;
        return GLib.SOURCE_REMOVE;
      });
    });
    trGroup.add(proxyRow);

    // Google 官方 API key（可选）：填了改用官方接口，不会被风控
    const keyRow = new Adw.EntryRow({ title: 'Google 官方 API key（可选，留空用免费接口）' });
    keyRow.text = settings.get_string('google-api-key');
    keyRow.connect('changed', () => settings.set_string('google-api-key', keyRow.text.trim()));
    trGroup.add(keyRow);

    // 快捷键组：点击输入框后直接按组合键捕获
    const hkGroup = new Adw.PreferencesGroup({
      title: '快捷键',
      description: '点击输入框后直接按下组合键，立即生效',
    });
    page.add(hkGroup);

    const hkRow = new Adw.ActionRow({ title: '翻译选中文本', subtitle: '点击按钮后直接按下组合键，Esc 取消' });
    const current = () => settings.get_strv('translate-shortcut').join(' ') || '未设置';
    const hkButton = new Gtk.Button({ label: current(), valign: Gtk.Align.CENTER });
    hkRow.add_suffix(hkButton);
    hkGroup.add(hkRow);

    let capturing = false;
    let candidate = null;
    hkButton.connect('clicked', () => {
      capturing = true;
      candidate = null;
      hkButton.label = '请按下组合键…';
    });

    const controller = new Gtk.EventControllerKey();
    controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    window.add_controller(controller);

    controller.connect('key-pressed', (_c, keyval, _keycode, state) => {
      if (!capturing) return false;
      const accel = Gtk.accelerator_name(keyval, state);
      if (/^<(Control|Alt|Super|Shift)/.test(accel)) {
        candidate = accel; // 候选，松开时保存
        hkButton.label = accel + '（松开以确认）';
        return true;
      }
      if (keyval === Gdk.KEY_Escape) {
        capturing = false;
        candidate = null;
        hkButton.label = current();
      }
      return true; // 无修饰键的单键吞掉
    });

    controller.connect('key-released', (_c, keyval, _keycode, state) => {
      if (!capturing || !candidate) return false;
      const accel = Gtk.accelerator_name(keyval, state);
      if (accel === candidate) {
        settings.set_strv('translate-shortcut', [candidate]);
        hkButton.label = candidate;
        capturing = false;
        candidate = null;
        return true;
      }
      return false;
    });
  }
}
