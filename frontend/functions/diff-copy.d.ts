export type DiffGuideSection = { h2: string; paragraphs: string[] };
export type DiffGuide = {
  description: string;
  intro: string;
  sections: DiffGuideSection[];
  faqTitle: string;
  faq: Array<{ question: string; answer: string }>;
};
// Pages Functions compiles every file under functions/ as a route module, so
// this file must also be valid as plain TypeScript.
export declare const DIFF_GUIDE: DiffGuide;
