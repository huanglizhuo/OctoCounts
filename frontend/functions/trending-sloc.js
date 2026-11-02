export function trendingSloc(value) {
  if (!Number.isSafeInteger(value?.code) || value.code < 0
    || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) return null;
  return { code: value.code, generatedAt: new Date(value.generatedAt).toISOString() };
}
