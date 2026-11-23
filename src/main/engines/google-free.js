const { request } = require('../net');

const LANG_MAP = { 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', ru: 'ru', es: 'es' };

// 端点 1：clients5.google.com（Chrome 词典端点 dict-chrome-ex，稳定且少风控）
// 响应格式：[["译文","检测语言"], ...]
async function viaClients5(text, sl, tl) {
  const url = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex'
    + `&sl=${sl}&tl=${tl}&q=${encodeURIComponent(text)}`;
  const res = await request(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } });
  if (!res.ok) throw new Error(`google-free(clients5) HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('clients5 响应格式变化');
  return { text: data[0][0], detected: data[0][1] };
}

// 端点 2：translate_a/single（经典网页版接口，data[0] 为分段数组）
async function viaGtx(text, sl, tl) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t'
    + `&sl=${sl}&tl=${tl}&q=${encodeURIComponent(text)}`;
  const res = await request(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } });
  if (!res.ok) throw new Error(`google-free(gtx) HTTP ${res.status}`);
  const data = await res.json();
  const out = (data[0] || []).map((s) => s[0]).join('');
  return { text: out, detected: data[2] };
}

module.exports = {
  id: 'google-free',
  name: 'Google 翻译（免 key）',
  needsKey: false,
  async translate(text, { from = 'auto', to = 'zh-CN' } = {}) {
    const sl = LANG_MAP[from] || from;
    const tl = LANG_MAP[to] || to;
    try {
      return await viaClients5(text, sl, tl);
    } catch (e1) {
      try {
        return await viaGtx(text, sl, tl);
      } catch (e2) {
        throw new Error(`${e1.message}; ${e2.message}`);
      }
    }
  },
};
