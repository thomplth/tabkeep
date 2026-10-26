const MAX_NAME_LENGTH = 24;

const INSTRUCTION =
  'Name a browser tab group containing the tabs listed by the user. ' +
  'Reply with only the name: 1 to 3 words, Title Case, no quotes or trailing punctuation.';

const describe = (tabs) => tabs.map((tab) => `- ${tab.title || '(untitled)'} | ${tab.url}`).join('\n');

export async function suggestGroupName(tabs) {
  try {
    const name = tidy(await nameWithBuiltInModel(tabs));
    if (name) return name;
  } catch (error) {
    console.warn('[tabkeep] built-in model failed to name group', error);
  }
  return heuristicName(tabs);
}

async function nameWithBuiltInModel(tabs) {
  if (typeof LanguageModel === 'undefined') return null;
  if ((await LanguageModel.availability()) !== 'available') return null;

  const session = await LanguageModel.create({ initialPrompts: [{ role: 'system', content: INSTRUCTION }] });
  try {
    return await session.prompt(describe(tabs));
  } finally {
    session.destroy();
  }
}

function tidy(name) {
  const cleaned = name
    ?.split('\n')[0]
    .replace(/["'`*.]/g, '')
    .trim();
  return cleaned ? cleaned.slice(0, MAX_NAME_LENGTH) : null;
}

export function heuristicName(tabs) {
  const counts = new Map();
  for (const site of tabs.map((tab) => siteName(tab.url)).filter(Boolean)) {
    counts.set(site, (counts.get(site) ?? 0) + 1);
  }
  const [site] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['Tabs'];
  return site;
}

function siteName(url) {
  try {
    const { hostname } = new URL(url);
    if (!hostname || /^[\d.]+$/.test(hostname) || hostname === 'localhost') return hostname || null;
    const labels = hostname.replace(/^www\./, '').split('.');
    const label = labels.at(-2) ?? labels[0];
    return label[0].toUpperCase() + label.slice(1);
  } catch {
    return null;
  }
}
