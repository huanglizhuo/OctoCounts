// The diff tool's guide copy, shared by the edge response and the hydrated
// /diff page (like report-copy.js and language-pages.js): one source for the
// explanation and the FAQ, so server- and client-rendered content cannot
// drift. English in every interface language, like the curated comparisons.
// Facts only, each one stated on the methodology page or in the tool itself.

export const DIFF_GUIDE = {
  description: "Compare source line count changes between two branches, tags, or commits in a public GitHub repository: code, comment and blank line deltas, pinned to commits.",
  intro: "The diff tool counts two refs of one public GitHub repository, a base and a head, and shows how the line counts moved between them: files, total lines, code lines, comment lines and blank lines, per language. Enter a repository URL and two refs. Each side is resolved to an exact commit SHA and counted with tokei, and the page reports the net change from base to head.",
  sections: [
    {
      h2: "What the diff reports",
      paragraphs: [
        "The diff is a net size change between two counted trees, head minus base. It is not Git's count of added and deleted lines: a pull request that adds 400 lines and deletes 390 of the same file moves the count by about 10 lines, while Git lists 400 additions and 390 deletions. Use Git's diff to review what changed and this tool to see how the repository's size moved.",
        "Percentage change uses the base count. A base with zero counted lines and a head with lines is shown as New, because a percentage against zero is not defined.",
      ],
    },
    {
      h2: "How both sides are counted",
      paragraphs: [
        "Both refs are counted under the same options. By default documentation, test and generated directories are excluded, and dependency and build folders are always skipped. The tool checks the policy version, the tokei version and the effective rules of both reports before the change is interpreted, and says so when they differ or are unknown.",
        "Each report is pinned to the commit it counted, so a later run of the same diff can show different numbers when a branch has moved. Share the page's link to keep the two saved results; saved results remain subject to cache retention.",
      ],
    },
  ],
  faqTitle: "Diff FAQ",
  faq: [
    {
      question: "Is the SLOC diff the same as Git's added and deleted lines?",
      answer: "No. OctoCounts reports the net size change between two counted trees, head minus base. A pull request that adds 400 lines and deletes 390 of the same file moves the count by about 10 lines, while Git lists 400 additions and 390 deletions.",
    },
    {
      question: "How is the percentage change calculated?",
      answer: "Percentage change uses the base count. A base with zero counted lines and a head with lines is shown as New, because a percentage against zero is not defined.",
    },
    {
      question: "Can I diff a private repository or two different repositories?",
      answer: "Not with this tool. It works on public GitHub repositories only, and both refs must belong to the same repository. To compare two different repositories, use the compare tool or one of the curated comparisons.",
    },
    {
      question: "Does a large diff mean more work was done?",
      answer: "No. Line counts measure size, not effort, complexity or quality. A large net change can come from generated code, vendored dependencies or a renamed file, and a small one can hide a difficult change. Read the diff in Git to judge the work.",
    },
    {
      question: "Why did the same diff show different numbers later?",
      answer: "A branch or tag can move. Each side is resolved to an exact commit SHA when the diff runs, so a later run of the same refs can count newer commits. The page's shared link keeps the two saved results; saved results remain subject to cache retention.",
    },
  ],
};
