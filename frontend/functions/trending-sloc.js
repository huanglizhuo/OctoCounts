export function trendingSloc(value) {
  if (!Number.isSafeInteger(value?.code) || value.code < 0
    || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
    || typeof value.reportId !== "string" || !/^[a-f0-9]{64}$/i.test(value.reportId)) return null;
  return { code: value.code, generatedAt: new Date(value.generatedAt).toISOString(), reportId: value.reportId };
}

export function trendingReportPath(repo) {
  const sloc = trendingSloc(repo.sloc);
  return sloc ? `${repo.publicPath}?reportId=${sloc.reportId}` : repo.publicPath;
}

export function trendingIsStale(snapshot, now = Date.now()) {
  // Daily snapshots get a 12-hour grace period for upstream and workflow delays.
  return now - Date.parse(snapshot.generatedAt) > 36 * 60 * 60 * 1000;
}

export function validateTrendingSnapshot(snapshot) {
  return snapshot && snapshot.source === "https://github.com/trending"
    && typeof snapshot.generatedAt === "string" && Number.isFinite(Date.parse(snapshot.generatedAt))
    && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.date) && new Date(snapshot.generatedAt).toISOString().slice(0, 10) === snapshot.date
    && Array.isArray(snapshot.repositories) && snapshot.repositories.every((repo) =>
      typeof repo?.fullName === "string" && typeof repo.description === "string"
      && (repo.language === null || typeof repo.language === "string")
      && Number.isSafeInteger(repo.rank) && repo.rank > 0
      && Number.isSafeInteger(repo.starsToday) && repo.starsToday >= 0
      && (repo.totalStars === undefined || (Number.isSafeInteger(repo.totalStars) && repo.totalStars >= 0))
      && typeof repo.publicPath === "string" && /^\/github\/[A-Za-z0-9_.~-]+(?:%[0-9A-Fa-f]{2})*\/[A-Za-z0-9_.~-]+(?:%[0-9A-Fa-f]{2})*$/.test(repo.publicPath))
    ? snapshot
    : null;
}
