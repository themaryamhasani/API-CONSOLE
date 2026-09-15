'use strict';

const {
  assertLogicalSuccess,
  getDataSource,
  responseLogicalError,
} = require('./core-client.cjs');
const { requiredWorkspaces, hasProjectKey } = require('../access/workspace-access.cjs');

const PROBE_REPOS = [
  { key: 'cde/repository/web-ui/list/fetch', suffix: 'web-ui' },
  { key: 'cde/repository/api-module/list/fetch', suffix: 'api-module' },
  { key: 'cde/repository/data-service/list/fetch', suffix: 'data-service' },
];

function looksLikeAccessDenied(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return /access|denied|forbid|permission|unauthorized|not\s+allowed|مجاز|دسترسی/.test(text);
}

/**
 * Confirm membership for required workspaces (e.g. medu-ai) by probing repository
 * list APIs — used when my-repo omits a workspace the user can open in CDE UI
 * (https://cde.edus.ir/workspace/medu-ai).
 *
 * Only a successful logical CDE response counts as membership.
 */
async function probeRequiredWorkspaceKeys(state, knownProjects = [], env = process.env) {
  const required = requiredWorkspaces(env);
  const merged = Array.from(new Set((knownProjects || []).map(String).filter(Boolean)));
  if (!required.length) return { projects: merged, state };

  let nextState = state;
  for (const workspaceKey of required) {
    if (hasProjectKey(merged, workspaceKey)) continue;
    let granted = false;
    for (const probe of PROBE_REPOS) {
      try {
        const callResult = await getDataSource(nextState, probe.key, {
          repoName: `${workspaceKey}/${probe.suffix}`,
        });
        nextState = callResult.state;
        const logical = responseLogicalError(callResult.response);
        if (logical) {
          if (looksLikeAccessDenied(logical)) break;
          continue;
        }
        assertLogicalSuccess(callResult.response);
        // Empty / missing Result is not proof of membership — avoid false grants.
        const payload = callResult.response?.Result;
        const hasPayload = payload != null
          && (typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length > 0);
        if (!hasPayload) continue;
        granted = true;
        break;
      } catch (error) {
        if (looksLikeAccessDenied(error)) break;
        if (error?.category === 'CDE_HTTP_ERROR' && /HTTP\s+404\b/i.test(String(error.message || ''))) {
          continue;
        }
        // Other transport errors: try next repository type.
      }
    }
    if (granted) merged.push(workspaceKey);
  }
  return { projects: Array.from(new Set(merged)), state: nextState };
}

module.exports = {
  probeRequiredWorkspaceKeys,
  looksLikeAccessDenied,
};
