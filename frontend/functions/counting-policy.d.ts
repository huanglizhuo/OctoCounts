import type { Report } from "../src/types";
export function comparePolicies(left: Pick<Report, "countingPolicy" | "tokeiVersion">, right: Pick<Report, "countingPolicy" | "tokeiVersion">): { status: "unknown" | "same" | "different"; differences: Array<{ key: string; left: string; right: string }> };
