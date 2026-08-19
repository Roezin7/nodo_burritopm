import { describe, expect, it } from 'vitest';
import { resolverReleaseId } from './release-notifications.js';

describe('identificador de release para avisos de deploy', () => {
  it('prioriza el identificador explícito', () => {
    expect(resolverReleaseId({ APP_RELEASE_ID: '  deploy-34 ', RENDER_GIT_COMMIT: 'platform-sha' })).toBe('deploy-34');
  });

  it('usa el SHA expuesto por la plataforma cuando no hay override', () => {
    expect(resolverReleaseId({ RENDER_GIT_COMMIT: 'render-sha-123' })).toBe('render-sha-123');
  });

  it('no inventa un release en reinicios sin identificador', () => {
    expect(resolverReleaseId({})).toBeNull();
  });
});
