# 提交到 extensions.gnome.org：表单填写参考

上传页：<https://extensions.gnome.org/upload/>（需要 GNOME 账号，先登录）。
包已经打好：`ext/dist/word-translator@local.zip`，本地自检 `shexli` 结果 **0 error / 0 warning**
（只剩一条 `EGO-A-005` 的 `manual_review`，因为扩展本身就要读剪贴板，描述里已声明）。

| 表单字段 | 填什么 |
| --- | --- |
| 上传文件 | `ext/dist/word-translator@local.zip` |
| 名称（Title） | Word Translator |
| 描述（Description） | 见下面代码块，整段复制（和 `metadata.json` 完全一致，663 字符） |
| 截图 | `docs/screenshots/01-scroll.png`、`02-select-copy.png`、`03-maximized.png`（都是 1600×900，16:9） |
| 支持的 shell 版本 | 45, 46, 47, 48 |
| 项目主页（url，含在包里） | `https://github.com/jesee/word-translator` |
| 版本说明（Version notes） | `First upload: selection popup with editable, scrollable original/translation panes, movable and maximisable window, Google engine with Tencent fallback.` |

## 描述（直接粘贴）

```text
Translate the text you select, right from a popup on your desktop.

Select text anywhere, press the shortcut you set in the preferences, and the original text and its translation appear in a movable popup with two editable, scrollable panes. Copy what you need with Ctrl+C, or fix a typo and translate again. Chinese, English, Japanese and Korean, with a Google engine and an automatic Tencent fallback.

Clipboard: the selection is read only when you press your shortcut (or turn on auto mode yourself), and Ctrl+C inside the popup writes to the clipboard. No shortcut is preset. Text is sent only to the translation endpoint.

选中文字按快捷键即可翻译，弹窗里原文和译文都能编辑、滚动、选中复制。
```

## metadata.json 里的字段

| 键 | 值 | 说明 |
| --- | --- | --- |
| `uuid` | `word-translator@local` | 安装目录名。审核一般要求 namespace 是域名/账号，见文末 |
| `url` | `https://github.com/jesee/word-translator` | eGO 强制要求，缺了上传直接报「缺少 url 字段」 |
| `version` | `1` | eGO 控制的提交号，整数；首次 1，之后每传一次自动 +1，声明了也会被覆盖 |
| `version-name` | `1.0.3` | 用户看到的版本（`gnome-extensions info`），1–16 位字母/数字/空格/句点 |

以后发新版、换主页，都不用手改 json：

```bash
VERSION=1.1.0 ./ext/package.sh                                   # 版本号
URL=https://github.com/你/word-translator ./ext/package.sh        # 项目主页
UUID=word-translator@你.github.io ./ext/package.sh                # uuid
```

## 审核状态怎么读

| 页面上的字样 | 含义 |
| --- | --- |
| `Unreviewed` | **正常排队**，等志愿者审核，没有任何问题 |
| `Rejected`（带 reviewer 评论） | 真被拒，会写明原因 |
| `auto-rejected` | **不是被拒**：你上传了更新的版本，旧版本被站点自动关掉 |
| `Approved` / `Active` | 通过，可以在站点装上 |

当前状态（extension 11917）：

| 版本 | 状态 | 说明 |
| --- | --- | --- |
| 1.0.0 (1) | Rejected | `Auto-rejected because of new version 1.0.3 (2) was uploaded` —— 我们传了 1.0.3，它被自动关掉 |
| 1.0.3 (2) | **Unreviewed** | 排队中，`No comments` = 审核员还没看 |

审核由志愿者做，通常几天到几周，期间详情页 `/extension/11917/` 对外是 404（未审核不公开），这是正常的。

## 审核员可能会问什么，怎么答

| 可能的问题 | 准备的说辞 |
| --- | --- |
| 为什么用 `curl` 而不是 libsoup | 需要 `--max-time` 硬超时、`-x` 代理，以及仅对证书过期的 `transmart.qq.com` 单独放开校验；zip 里不含任何二进制，curl 是系统依赖，`Gio.Subprocess` 启动并在回调里收尾，`disable()` 不残留 |
| 为什么读剪贴板 | 描述里已声明；只在用户按自己设置的快捷键时读 PRIMARY，或用户亲手打开自动模式时才读；没有预置快捷键 |
| uuid 的 `@local` | namespace 应该是自己控制的域名/账号。备用包已经准备好：`ext/dist/word-translator@jesee.github.io.zip`，被要求改时直接上传即可（注意 eGO 不能改已有 uuid，会变成一个**新扩展条目**，旧条目弃用） |
| 图标是占位的 | 扩展页面上点图标可以上传，用 `docs/icon.png`（512×512） |

## 三张截图分别展示

1. `01-scroll.png` —— 长文本：原文区自动滚动（上下有淡出提示），译文区自动换行，内容不会撑破窗口。
2. `02-select-copy.png` —— 在译文里选中一段（蓝底白字），Ctrl+A 全选、Ctrl+C 复制、也可以直接改字。
3. `03-maximized.png` —— 点标题栏的最大化按钮，窗口铺满工作区。

## 提交后给审核员的一句话（写在 review 页的评论里）

```text
Thanks for reviewing! Notes:
- Clipboard: PRIMARY is read only on the user's shortcut, or in the auto mode the user has to enable.
  Ctrl+C inside the popup writes to CLIPBOARD. St.Clipboard is used directly because ClutterText in
  mutter 46 has no clipboard handling of its own. No default shortcut is shipped (empty `as` default).
- Network: text goes to clients5.google.com (public web endpoint) with transmart.qq.com as fallback,
  via curl through Gio.Subprocess. No API key, nothing else is contacted.
- Everything is created in enable() and destroyed/disconnected in disable(); signals are tracked in
  _track()/_untrack() so nothing leaks between enable cycles.
```

## 项目主页

`url` 填的是 `https://github.com/jesee/word-translator`，仓库已建好并推送成功（公开可访问），
审核要求的「能打开的项目地址」这条满足了。换仓库时：

```bash
URL=https://github.com/你的用户名/你的仓库名 ./ext/package.sh
```

另外 uuid 的 `@local` 也不是域名，审核时大概率会被要求改；换的时候一条命令：
`UUID=word-translator@你的用户名.github.io ./ext/package.sh`（schema id 不变，设置不会丢）。

LICENSE 已经在包里（GPL-3.0-or-later，和 GNOME Shell 兼容），仓库根目录也放了一份。
