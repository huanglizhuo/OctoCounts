export function comparePolicies(left, right) {
  if (!left.countingPolicy || !right.countingPolicy || !left.tokeiVersion || !right.tokeiVersion) return { status: "unknown", differences: [] };
  const dimensions = (report) => {
    const policy = report.countingPolicy;
    return {
      counter: report.tokeiVersion,
      version: policy.version,
      includeDocs: policy.includeDocs,
      includeTests: policy.includeTests,
      includeGenerated: policy.includeGenerated,
      ignoredDirs: [...new Set(policy.ignoredDirs)].sort(),
      ignoredLanguages: [...new Set(policy.ignoredLanguages.map((language) => language.toLowerCase()))].sort(),
      respectGitattributes: policy.repositoryAttributes.status !== "off",
    };
  };
  const a = dimensions(left);
  const b = dimensions(right);
  const differences = Object.keys(a).filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).map((key) => ({ key, left: JSON.stringify(a[key]), right: JSON.stringify(b[key]) }));
  return { status: differences.length ? "different" : "same", differences };
}
