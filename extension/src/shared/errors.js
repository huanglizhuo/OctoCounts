import { t } from '../i18n/index.js';

const CODE_MAP = {
  queue_full: t('error.queueFull'),
  service_unavailable: t('error.serviceUnavailable'),
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
  const message = CODE_MAP[error?.code] || error?.message || t('error.unknown');
  if (!(error?.retryAfterMs > 0)) return message;
  return message + ' ' + t('error.retryAfter', { seconds: Math.ceil(error.retryAfterMs / 1000) });
}
