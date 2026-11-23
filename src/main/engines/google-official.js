const { request } = require('../net');

// Google Cloud Translation API v2，BYOK：用户在设置里填自己的 key。
module.exports = {
  id: 'google-official',
  name: 'Google 官方 API（需 key）',
  needsKey: true,
  async translate(text, { from = 'auto', to = 'zh-CN', apiKey } = {}) {
    if (!apiKey) throw new Error('未配置 API key');
    const res = await request(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        target: to,
        ...(from !== 'auto' ? { source: from } : {}),
        format: 'text',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`google-official: ${data?.error?.message || res.status}`);
    const t = data?.data?.translations?.[0];
    return { text: t?.translatedText, detected: t?.detectedSourceLanguage };
  },
};
