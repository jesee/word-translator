// 引擎接口约定：{ id, name, needsKey, async translate(text, { from, to, proxy }) -> { text, raw? } }
// 各引擎实现自行处理网络请求与错误，抛出 Error 即表示失败（触发降级链）。
