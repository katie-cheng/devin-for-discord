export const TEMPLATES = [
  {
    id: 'open-pr',
    name: 'Open a PR',
    description: 'Write code and open a pull request',
    emoji: '🔀',
    fields: [
      { id: 'repo', label: 'Repository', placeholder: 'owner/repo-name', short: true, required: true },
      { id: 'details', label: 'What should the PR do?', placeholder: 'Add a REST API endpoint for user profiles', short: false, required: true },
    ],
    buildPrompt: ({ repo, details }) =>
      `In the GitHub repo ${repo}: ${details}\n\nOpen a pull request with the changes.`,
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Review a pull request for issues',
    emoji: '🔍',
    fields: [
      { id: 'url', label: 'Pull Request URL', placeholder: 'https://github.com/owner/repo/pull/123', short: true, required: true },
      { id: 'focus', label: 'Focus areas (optional)', placeholder: 'Security, performance, edge cases...', short: false, required: false },
    ],
    buildPrompt: ({ url, focus }) => {
      let prompt = `Review this pull request: ${url}\n\nProvide a thorough code review. Look for bugs, security issues, and code quality problems.`;
      if (focus) prompt += `\n\nPay special attention to: ${focus}`;
      return prompt;
    },
  },
  {
    id: 'write-tests',
    name: 'Write Tests',
    description: 'Add test coverage to a repo',
    emoji: '🧪',
    fields: [
      { id: 'repo', label: 'Repository', placeholder: 'owner/repo-name', short: true, required: true },
      { id: 'details', label: 'What to test?', placeholder: 'The auth module in src/auth/', short: false, required: true },
    ],
    buildPrompt: ({ repo, details }) =>
      `In the GitHub repo ${repo}: Write comprehensive tests for ${details}\n\nFollow existing test patterns in the repo. Open a pull request with the tests.`,
  },
  {
    id: 'fix-bug',
    name: 'Fix a Bug',
    description: 'Investigate and fix a bug',
    emoji: '🐛',
    fields: [
      { id: 'repo', label: 'Repository', placeholder: 'owner/repo-name', short: true, required: true },
      { id: 'details', label: 'Describe the bug', placeholder: 'The login endpoint returns 500 when...', short: false, required: true },
    ],
    buildPrompt: ({ repo, details }) =>
      `In the GitHub repo ${repo}: Investigate and fix this bug: ${details}\n\nOpen a pull request with the fix.`,
  },
];

export function getTemplate(id) {
  return TEMPLATES.find(t => t.id === id);
}
