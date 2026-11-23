const engines = {
  'google-free': require('./google-free'),
  transmart: require('./transmart'),
  'google-official': require('./google-official'),
};

function getEngine(id) {
  return engines[id] || engines['google-free'];
}

// 降级链：主引擎失败 -> transmart -> 抛错
async function translateWithFallback(text, opts) {
  const { settings } = opts;
  const chain = [settings.engine || 'google-free'];
  if (chain[0] !== 'transmart') chain.push('transmart');

  let lastErr;
  for (const id of chain) {
    const engine = engines[id];
    if (!engine) continue;
    if (engine.needsKey && !settings.apiKeys?.[id]) {
      lastErr = new Error(`${engine.name} 未配置 key`);
      continue;
    }
    try {
      const r = await engine.translate(text, {
        from: opts.from,
        to: opts.to,
        proxy: settings.proxy,
        apiKey: settings.apiKeys?.[id],
      });
      return { ...r, engine: engine.id, engineName: engine.name };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('没有可用翻译引擎');
}

module.exports = { engines, getEngine, translateWithFallback };
