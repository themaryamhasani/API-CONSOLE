'use strict';

function resultOf(response) {
  return response?.Result || {};
}

function itemsOf(response) {
  const result = resultOf(response);
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.list)) return result.list;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.value)) return result.value;
  if (Array.isArray(result?.projects)) return result.projects;
  if (Array.isArray(result?.workspaces)) return result.workspaces;
  if (Array.isArray(result?.repositories)) return result.repositories;
  if (Array.isArray(result?.myRepos)) return result.myRepos;
  if (Array.isArray(result?.myWorkspaces)) return result.myWorkspaces;
  return [];
}

function stripProjectKeySegment(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.split('/')[0].split('>')[0].trim();
}

function projectKeyFromRepoItem(item) {
  if (item == null) return '';
  if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
    return stripProjectKeySegment(item);
  }
  if (typeof item !== 'object') return '';
  const fields = [
    item.projectKey,
    item.project,
    item.workspace,
    item.workspaceKey,
    item.workspaceId,
    item.workspaceName,
    item.key,
    item.slug,
    item.code,
    item.repo,
    item.repository,
    item.id,
    item._id,
    item.name,
    item.repositoryName,
    item.repoName,
    item.title,
  ];
  for (const field of fields) {
    const key = stripProjectKeySegment(field);
    if (key && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(key)) return key;
  }
  return '';
}

function keysFromObjectMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value)
    .map(stripProjectKeySegment)
    .filter(key => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(key));
}

/**
 * Normalize CDE my-repo / workspace list responses into project keys.
 */
function projectKeysFromMyRepoResponse(response) {
  const directItems = itemsOf(response);
  const fromItems = directItems.map(projectKeyFromRepoItem).filter(Boolean);
  if (fromItems.length) return Array.from(new Set(fromItems));

  const result = resultOf(response);
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [];

  for (const nested of [result.repositories, result.projects, result.workspaces]) {
    if (Array.isArray(nested)) {
      const keys = nested.map(projectKeyFromRepoItem).filter(Boolean);
      if (keys.length) return Array.from(new Set(keys));
    }
    if (nested && typeof nested === 'object') {
      const keys = keysFromObjectMap(nested);
      if (keys.length) return keys;
    }
  }

  return keysFromObjectMap(result);
}

module.exports = {
  itemsOf,
  projectKeyFromRepoItem,
  projectKeysFromMyRepoResponse,
  resultOf,
  stripProjectKeySegment,
};
