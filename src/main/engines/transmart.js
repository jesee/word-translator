const { request } = require('../net');

// 腾讯交互翻译 TranSmart（transmart.qq.com）网页接口，国内直连、免 key。
// 接口为非公开端点，若失效请替换。
const LANG_MAP = { 'zh-CN': 'zh', en: 'en', ja: 'jp', ko: 'kr', fr: 'fr', de: 'de', ru: 'ru', es: 'es' };

module.exports = {
  id: 'transmart',
  name: '腾讯交互翻译（国内直连）',
  needsKey: false,
  async translate(text, { from = 'auto', to = 'zh-CN' } = {}) {
    const source = LANG_MAP[from] || 'auto';
    const target = LANG_MAP[to] || 'zh';
    const res = await request('https://transmart.qq.com/api/imt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({
        header: { fn: 'auto_translation', session: '' },
        source,
        target,
        source_text: text,
      }),
    }, { timeout: 8000 });
    if (!res.ok) throw new Error(`transmart HTTP ${res.status}`);
    const data = await res.json();
    const out = data?.auto_translation;
    if (!out) throw new Error('transmart 响应格式变化');
    return { text: out };
  },
};
