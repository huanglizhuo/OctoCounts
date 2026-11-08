import { t } from '../i18n/index.js';

// Maps background error codes to localized, user-readable one-liners.
// (classifyError returns {code, status, detail} without a message.)
//
// Every terminal code needs an entry here, because there is no second line of
// defence: `classifyError` in `background/index.js` returns
// `{ code, status, detail }` and drops the API's `message`, so the
// `error?.message` term below is always `undefined`. An unmapped code
// therefore renders as just "Analysis failed". `ref_not_found` also covers a
// repository with no commits, which the API reports under this same code.
const CODE_MAP = {
  rate_limited: t('error.rateLimited'),
  github_unavailable: t('error.githubUnavailable'),
  private_repo: t('error.privateRepo'),
  forbidden:    t('error.forbidden'),
  too_large:    t('error.tooLarge'),
  not_found:    t('error.notFound'),
  auth_error:   t('error.authError'),
  offline:      t('error.offline'),
  timeout:      t('card.error.timedOut'),
  ref_not_found: t('error.refNotFound'),
  invalid_url:   t('error.invalidUrl'),
};

export function errorMessage(error) {
  return CODE_MAP[error?.code] || error?.message || t('error.unknown');
}
