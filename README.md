# word-translator 划词翻译

Electron + Node.js 划词翻译工具，多引擎 + 自动降级 + 免 key 开箱即用。

## 引擎

| 引擎 | key | 说明 |
|---|---|---|
| google-free（默认） | 不需要 | Google 网页版接口 `client=gtx`，需能访问 Google |
| transmart | 不需要 | 腾讯交互翻译，国内直连，作为降级备选 |
| google-official | 需要用户自己的 | Google Cloud Translation API v2，BYOK |

## 使用

```bash
npm install
npm start
```

1. 选中任意应用中的文字，按 `Alt+T` 弹出翻译窗口（Linux 依赖 `xdotool`：`sudo apt install xdotool`）。
2. 托盘/窗口内设置：默认引擎、目标语言、热键、代理、官方 API key。

## 注意

- `google-free` / `transmart` 为非公开接口，随时可能失效，仅建议个人使用；商用请走官方 API（BYOK，勿把 key 打包进客户端）。
- 大陆网络使用 google-free 需在设置中填写 HTTP 代理。
