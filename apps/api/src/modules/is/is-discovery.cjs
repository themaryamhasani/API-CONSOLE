'use strict';

const fs = require('fs');
const path = require('path');

const IS_APPLICATION_PREFIX = 'is:';

function gatewayBaseUrl() {
  const raw = String(process.env.API_CONSOLE_IS_GATEWAY_URL || 'http://127.0.0.1:4000').trim().replace(/\/+$/, '');
  return raw.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
}

function applicationIdForService(serviceKey) {
  return `${IS_APPLICATION_PREFIX}${serviceKey}`;
}

function defaultSystemsCatalog() {
  // Lazy require: is-auth-server may load discovery on demand.
  return require('./is-auth-server.cjs').defaultSystemsCatalog();
}

function serviceKeyFromApiPath(apiPath) {
  const text = String(apiPath || '').trim();
  const match = text.match(/\/api\/v1\/([^/?#]+)/i);
  if (match) return match[1];
  return text.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).pop() || '';
}

function normalizeApiPath(api) {
  const s = String(api || '').trim();
  if (!s) return '/';
  const normalized = s.startsWith('/') ? s : `/${s}`;
  return normalized.replace(/\/+$/, '') || '/';
}

function joinPaths(...parts) {
  const filtered = parts
    .map(p => (p == null ? '' : String(p)))
    .map(p => p.trim())
    .filter(p => p !== '' && p !== '/');
  if (!filtered.length) return '/';
  const joined = filtered
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/g, '');
  return joined.startsWith('/') ? joined || '/' : `/${joined}` || '/';
}

function normalizeGatewayPath(pathText) {
  return normalizeApiPath(pathText);
}

function fingerprintForOperation(method, pathText) {
  return `is:${String(method || 'GET').toUpperCase()}:${String(pathText || '')}`;
}

function buildAbsoluteGatewayUrl(apiPath) {
  const base = gatewayBaseUrl().replace(/\/+$/, '');
  return `${base}${normalizeGatewayPath(apiPath)}`;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function defaultSpecsRootCandidates() {
  const repoRoot = path.resolve(__dirname, '../../../../../../');
  return [
    path.resolve(repoRoot, '../IS/integrated-systems/specs/medu-apps'),
    path.resolve(repoRoot, '../IS/integrated-systems/specs/edus-apps'),
    path.resolve('D:/AllApp/IS/integrated-systems/specs/medu-apps'),
    path.resolve('D:/AllApp/IS/integrated-systems/specs/edus-apps'),
  ];
}

function resolveSpecsRoots() {
  const raw = String(process.env.API_CONSOLE_IS_SPECS_ROOT || '').trim();
  const segments = raw
    ? raw.split(',').map(item => item.trim()).filter(Boolean)
    : [];
  const resolved = [];
  const seen = new Set();
  const push = candidate => {
    try {
      const abs = path.resolve(candidate);
      if (seen.has(abs)) return;
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return;
      seen.add(abs);
      resolved.push(abs);
    } catch {
      /* skip */
    }
  };
  for (const segment of segments) push(segment);
  if (!resolved.length) {
    for (const candidate of defaultSpecsRootCandidates()) push(candidate);
  }
  return resolved;
}

function workspaceLabelFromRoot(rootPath) {
  const index = readJsonFile(path.join(rootPath, 'index.json'));
  if (index?.title) return String(index.title);
  if (index?.slug) return String(index.slug);
  return path.basename(rootPath);
}

function listWorkspaces() {
  return resolveSpecsRoots().map((rootPath, workspaceIndex) => {
    const index = readJsonFile(path.join(rootPath, 'index.json')) || {};
    return {
      workspaceIndex,
      rootPath,
      slug: String(index.slug || path.basename(rootPath)),
      title: String(index.title || index.slug || path.basename(rootPath)),
      description: String(index.description || ''),
      categories: Array.isArray(index.categories) ? index.categories : [],
      productCount: Array.isArray(index['spec-folders']) ? index['spec-folders'].length : 0,
    };
  });
}

function findProductDirectory(rootPath, slug, categoryHint) {
  const id = String(slug || '').trim();
  if (!id) return null;
  const candidates = [];
  if (categoryHint) candidates.push(path.join(rootPath, String(categoryHint), id));
  candidates.push(path.join(rootPath, id));
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.spec.json'))) return candidate;
  }
  // Fallback: shallow scan category/*/slug
  try {
    for (const category of fs.readdirSync(rootPath, { withFileTypes: true })) {
      if (!category.isDirectory()) continue;
      const candidate = path.join(rootPath, category.name, id);
      if (fs.existsSync(path.join(candidate, 'index.spec.json'))) return candidate;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveServiceFile(productDir) {
  const layout = readJsonFile(path.join(productDir, 'index.spec.json'));
  const relative = layout?.entityCore?.service;
  if (relative) {
    const abs = path.resolve(productDir, relative);
    if (fs.existsSync(abs)) return abs;
  }
  // Fallback: first *.service.json under product
  const stack = [productDir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.service.json')) {
        return full;
      }
    }
  }
  return null;
}

function resolveGatewayPath(baseUrl, controllerPath, actionPath) {
  const base = normalizeApiPath(baseUrl);
  const ctrl = normalizeApiPath(controllerPath);
  const act = normalizeApiPath(actionPath);
  if (act !== '/' && (act === base || act.startsWith(`${base}/`))) return act;
  if (act !== '/' && ctrl !== '/' && (act === ctrl || act.startsWith(`${ctrl}/`))) {
    return joinPaths(base, act);
  }
  if (act === '/' || act === '') return joinPaths(base, ctrl);
  return joinPaths(base, ctrl, act);
}

function operationsFromServicePayload(servicePayload, meta) {
  const services = Array.isArray(servicePayload?.services) ? servicePayload.services : [];
  const operations = [];
  for (const service of services) {
    const baseUrl = String(service.base_url || '').trim();
    const serviceKey = serviceKeyFromApiPath(baseUrl) || meta.serviceKey || meta.specFolder;
    const serviceName = String(service.name || serviceKey);
    const controllers = Array.isArray(service.controllers) ? service.controllers : [];
    for (const controller of controllers) {
      const controllerName = String(controller.name || 'controller');
      const controllerPath = String(controller.path || '');
      const actions = Array.isArray(controller.actions) ? controller.actions : [];
      for (const action of actions) {
        const method = String(action.method || 'GET').toUpperCase();
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) continue;
        const gatewayPath = resolveGatewayPath(baseUrl, controllerPath, action.path);
        const actionName = String(action.name || `${method} ${gatewayPath}`);
        const fingerprint = fingerprintForOperation(method, gatewayPath);
        operations.push({
          id: fingerprint,
          serviceKey,
          method,
          path: gatewayPath,
          name: action.description
            ? `${actionName} — ${String(action.description).slice(0, 80)}`
            : `${method} ${gatewayPath}`,
          description: String(action.description || ''),
          enabled: true,
          sourceKind: 'SPEC_SERVICE',
          sourceFingerprint: fingerprint,
          folderPath: [meta.category || 'specs', meta.specFolder, controllerName].filter(Boolean),
          operationId: actionName,
          controllerName,
          actionName,
          serviceName,
          requireLogin: Boolean(action.require_login ?? controller.require_login ?? false),
          kind: String(action.action_type || action.function_type || ''),
          specFolder: meta.specFolder,
          workspaceIndex: meta.workspaceIndex,
        });
      }
    }
  }
  return operations;
}

function productDescriptorFromFolder(workspace, folderMeta) {
  const specFolder = String(folderMeta.slug || '').trim();
  if (!specFolder) return null;
  const category = String(folderMeta.category || '').trim();
  const productDir = findProductDirectory(workspace.rootPath, specFolder, category);
  const warnings = [];
  let serviceKey = specFolder;
  let basePath = `/api/v1/${specFolder}`;
  let serviceTitle = '';
  let serviceFile = null;
  let actionCount = 0;

  if (!productDir) {
    warnings.push({ code: 'PRODUCT_DIR_MISSING', message: `Product folder missing for ${specFolder}` });
  } else {
    serviceFile = resolveServiceFile(productDir);
    if (!serviceFile) {
      warnings.push({ code: 'SERVICE_JSON_MISSING', message: `No *.service.json for ${specFolder}` });
    } else {
      const payload = readJsonFile(serviceFile);
      const service = Array.isArray(payload?.services) ? payload.services[0] : null;
      if (service?.base_url) {
        basePath = normalizeApiPath(service.base_url);
        serviceKey = serviceKeyFromApiPath(basePath) || serviceKey;
      }
      serviceTitle = String(service?.title || service?.name || '');
      if (payload) {
        actionCount = operationsFromServicePayload(payload, {
          specFolder,
          category,
          serviceKey,
          workspaceIndex: workspace.workspaceIndex,
        }).length;
      }
    }
  }

  return {
    applicationId: applicationIdForService(serviceKey),
    serviceKey,
    specFolder,
    label: String(folderMeta.title || serviceTitle || specFolder),
    description: String(folderMeta.description || serviceTitle || ''),
    basePath,
    gatewayBaseUrl: gatewayBaseUrl(),
    category: category || null,
    categoryTitle: null,
    workspaceIndex: workspace.workspaceIndex,
    workspaceSlug: workspace.slug,
    workspaceTitle: workspace.title,
    productDir: productDir || null,
    serviceFile: serviceFile || null,
    actionCount,
    source: 'specs-disk',
    sortOrder: Number(folderMeta.sort_order || 0),
    warnings,
  };
}

function listProductsFromDisk({ workspaceIndex, category } = {}) {
  const workspaces = listWorkspaces();
  const warnings = [];
  if (!workspaces.length) {
    warnings.push({
      code: 'SPECS_ROOT_MISSING',
      message: 'API_CONSOLE_IS_SPECS_ROOT is empty or paths are missing. Point it at specs/medu-apps (and optionally edus-apps).',
    });
    return { workspaces, products: [], warnings };
  }

  const selected = workspaceIndex === undefined || workspaceIndex === null || workspaceIndex === ''
    ? workspaces
    : workspaces.filter(item => item.workspaceIndex === Number(workspaceIndex));

  const categoryFilter = category ? String(category).trim() : '';
  const products = [];

  for (const workspace of selected) {
    const index = readJsonFile(path.join(workspace.rootPath, 'index.json')) || {};
    const categoryTitleBySlug = new Map(
      (Array.isArray(index.categories) ? index.categories : []).map(row => [String(row.slug), String(row.title || row.slug)])
    );
    const folders = Array.isArray(index['spec-folders']) ? index['spec-folders'] : [];
    for (const folder of folders) {
      if (categoryFilter && String(folder.category || '') !== categoryFilter) continue;
      const product = productDescriptorFromFolder(workspace, folder);
      if (!product) continue;
      product.categoryTitle = product.category ? (categoryTitleBySlug.get(product.category) || product.category) : null;
      if (product.warnings?.length) warnings.push(...product.warnings.map(w => ({ ...w, specFolder: product.specFolder })));
      delete product.warnings;
      products.push(product);
    }
  }

  products.sort((left, right) =>
    String(left.workspaceSlug).localeCompare(String(right.workspaceSlug))
    || String(left.category || '').localeCompare(String(right.category || ''))
    || String(left.label).localeCompare(String(right.label), 'fa')
  );

  return {
    gatewayBaseUrl: gatewayBaseUrl(),
    workspaces,
    products,
    warnings,
    discoveredAt: new Date().toISOString(),
    source: 'specs-disk',
  };
}

async function gatewayJson(pathname, cookieHeader, { method = 'GET', query } = {}) {
  const base = gatewayBaseUrl();
  const url = new URL(pathname.startsWith('/') ? pathname : `/${pathname}`, `${base}/`);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      redirect: 'follow',
    });
  } catch (error) {
    return { ok: false, status: 0, error: error.message || 'network error', data: null };
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data, error: response.ok ? null : (data?.error || data?.message || response.statusText) };
}

function mapCatalogService(row) {
  const serviceKey = String(row.slug || serviceKeyFromApiPath(row.api_path) || '').trim();
  if (!serviceKey) return null;
  const basePath = String(row.api_path || `/api/v1/${serviceKey}`).replace(/\/+$/, '') || `/api/v1/${serviceKey}`;
  return {
    applicationId: applicationIdForService(serviceKey),
    serviceKey,
    label: String(row.name || serviceKey),
    description: String(row.description || ''),
    basePath,
    gatewayBaseUrl: gatewayBaseUrl(),
    team: row.Team?.name || row.team?.name || null,
    teamSlug: row.Team?.slug || row.team?.slug || null,
    source: 'idp-docs-catalog',
    sortOrder: Number(row.sort_order || 0),
  };
}

async function discoverSystemsLive(cookieHeader) {
  const disk = listProductsFromDisk();
  const byKey = new Map();
  const warnings = [...(disk.warnings || [])];

  for (const product of disk.products) {
    byKey.set(product.serviceKey, {
      ...product,
      team: product.categoryTitle || product.category,
      teamSlug: product.category,
    });
  }

  if (cookieHeader) {
    const catalog = await gatewayJson('/api/v1/idp-docs/catalog', cookieHeader);
    if (catalog.ok) {
      const services = Array.isArray(catalog.data?.services) ? catalog.data.services : [];
      for (const row of services) {
        const mapped = mapCatalogService(row);
        if (!mapped) continue;
        const existing = byKey.get(mapped.serviceKey);
        if (existing) {
          byKey.set(mapped.serviceKey, {
            ...existing,
            team: mapped.team || existing.team,
            teamSlug: mapped.teamSlug || existing.teamSlug,
            description: existing.description || mapped.description,
            source: `${existing.source}+catalog`,
          });
        } else {
          byKey.set(mapped.serviceKey, mapped);
        }
      }
    } else {
      warnings.push({
        code: 'IDP_DOCS_CATALOG_UNAVAILABLE',
        message: catalog.error || `idp-docs catalog failed (${catalog.status})`,
      });
    }
  }

  // Platform builtins only when disk produced nothing for that key
  for (const row of defaultSystemsCatalog()) {
    if (!byKey.has(row.serviceKey)) {
      byKey.set(row.serviceKey, {
        ...row,
        source: 'static-fallback',
        team: null,
        teamSlug: null,
        sortOrder: 999,
        specFolder: null,
        actionCount: 0,
      });
    }
  }

  const systems = Array.from(byKey.values()).sort((left, right) =>
    (Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
    || String(left.label).localeCompare(String(right.label), 'fa')
  );

  return {
    gatewayBaseUrl: gatewayBaseUrl(),
    workspaces: disk.workspaces,
    systems,
    products: disk.products,
    warnings,
    discoveredAt: new Date().toISOString(),
    source: disk.products.length ? 'specs-disk' : 'fallback',
  };
}

function findProductMeta({ serviceKey, specFolder, workspaceIndex } = {}) {
  const disk = listProductsFromDisk({
    workspaceIndex: workspaceIndex === undefined || workspaceIndex === '' ? undefined : Number(workspaceIndex),
  });
  const key = String(serviceKey || '').trim();
  const folder = String(specFolder || '').trim();
  let product = null;
  if (folder) {
    product = disk.products.find(item =>
      item.specFolder === folder
      && (workspaceIndex === undefined || workspaceIndex === '' || Number(item.workspaceIndex) === Number(workspaceIndex))
    ) || null;
  }
  if (!product && key) {
    product = disk.products.find(item => item.serviceKey === key || item.specFolder === key) || null;
  }
  return { product, disk };
}

function discoverProductApisFromDisk({ serviceKey, specFolder, workspaceIndex } = {}) {
  const { product, disk } = findProductMeta({ serviceKey, specFolder, workspaceIndex });
  const warnings = [...(disk.warnings || [])];
  if (!product) {
    warnings.push({
      code: 'PRODUCT_NOT_FOUND',
      message: `No spec product matched serviceKey=${serviceKey || ''} specFolder=${specFolder || ''}`,
    });
    return {
      serviceKey: String(serviceKey || specFolder || ''),
      applicationId: applicationIdForService(String(serviceKey || specFolder || 'unknown')),
      gatewayBaseUrl: gatewayBaseUrl(),
      basePath: `/api/v1/${serviceKey || specFolder || ''}`,
      operations: [],
      counts: { total: 0, specs: 0, gateway: 0, openapi: 0 },
      warnings,
      product: null,
      discoveredAt: new Date().toISOString(),
    };
  }

  if (!product.serviceFile || !fs.existsSync(product.serviceFile)) {
    warnings.push({ code: 'SERVICE_JSON_MISSING', message: `service.json missing for ${product.specFolder}` });
    return {
      serviceKey: product.serviceKey,
      applicationId: product.applicationId,
      gatewayBaseUrl: gatewayBaseUrl(),
      basePath: product.basePath,
      operations: [],
      counts: { total: 0, specs: 0, gateway: 0, openapi: 0 },
      warnings,
      product,
      discoveredAt: new Date().toISOString(),
    };
  }

  const payload = readJsonFile(product.serviceFile);
  const operations = operationsFromServicePayload(payload, {
    specFolder: product.specFolder,
    category: product.category,
    serviceKey: product.serviceKey,
    workspaceIndex: product.workspaceIndex,
  });

  return {
    serviceKey: product.serviceKey,
    applicationId: product.applicationId,
    gatewayBaseUrl: gatewayBaseUrl(),
    basePath: product.basePath,
    operations,
    counts: { total: operations.length, specs: operations.length, gateway: 0, openapi: 0 },
    warnings,
    product,
    discoveredAt: new Date().toISOString(),
    source: 'specs-disk',
  };
}

function operationFromGatewayApi(row, serviceKey) {
  const method = String(row.method || 'GET').toUpperCase();
  const apiPath = normalizeGatewayPath(row.path);
  const prefix = `/api/v1/${serviceKey}`;
  if (!apiPath.startsWith(prefix) && apiPath !== prefix) {
    if (!apiPath.includes(`/${serviceKey}/`) && apiPath !== `/api/v1/${serviceKey}`) return null;
  }
  return {
    id: fingerprintForOperation(method, apiPath),
    serviceKey,
    method,
    path: apiPath,
    name: `${method} ${apiPath}`,
    description: row.is_enabled === false ? 'Disabled in gateway registry' : 'Registered via Gateway traffic',
    enabled: row.is_enabled !== false,
    sourceKind: 'GATEWAY_API',
    sourceFingerprint: fingerprintForOperation(method, apiPath),
    folderPath: ['Gateway'],
    lastSeenAt: row.last_seen_at || null,
  };
}

function expandOpenApiOperations(document, serviceKey) {
  const paths = document?.paths && typeof document.paths === 'object' ? document.paths : {};
  const servers = Array.isArray(document?.servers) ? document.servers : [];
  const serverBase = String(servers[0]?.url || '').replace(/\/+$/, '');
  const operations = [];
  for (const [rawPath, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue;
    for (const [methodName, operation] of Object.entries(methods)) {
      const method = String(methodName || '').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) continue;
      let apiPath = String(rawPath || '');
      if (serverBase && apiPath.startsWith('/') && !apiPath.startsWith('/api/')) {
        try {
          const joined = new URL(apiPath.replace(/^\//, ''), `${serverBase.endsWith('/') ? serverBase : `${serverBase}/`}`);
          apiPath = joined.pathname;
        } catch {
          apiPath = `${serverBase}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
          try {
            apiPath = new URL(apiPath, 'http://local.invalid').pathname;
          } catch {
            /* keep */
          }
        }
      }
      apiPath = normalizeGatewayPath(apiPath);
      if (!apiPath.startsWith('/api/')) {
        apiPath = normalizeGatewayPath(`/api/v1/${serviceKey}${apiPath === '/' ? '' : apiPath}`);
      }
      const summary = operation?.summary || operation?.operationId || `${method} ${apiPath}`;
      const tags = Array.isArray(operation?.tags) ? operation.tags : [];
      operations.push({
        id: fingerprintForOperation(method, apiPath),
        serviceKey,
        method,
        path: apiPath,
        name: summary,
        description: String(operation?.description || '').slice(0, 500),
        enabled: true,
        sourceKind: 'OPENAPI',
        sourceFingerprint: fingerprintForOperation(method, apiPath),
        folderPath: tags.length ? ['OpenAPI', String(tags[0])] : ['OpenAPI'],
        operationId: operation?.operationId || null,
      });
    }
  }
  return operations;
}

async function discoverOpenApiForService(serviceKey, cookieHeader) {
  const warnings = [];
  if (!cookieHeader) return { operations: [], warnings };
  const list = await gatewayJson('/api/v1/idp-docs/specs', cookieHeader, {
    query: { spec_type: 'openapi', limit: 100, skip: 0 },
  });
  if (!list.ok) {
    warnings.push({ code: 'OPENAPI_LIST_UNAVAILABLE', message: list.error || `specs list failed (${list.status})` });
    return { operations: [], warnings };
  }
  const rows = Array.isArray(list.data) ? list.data : (Array.isArray(list.data?.data) ? list.data.data : []);
  const matches = rows.filter(row => {
    const slug = String(row.slug || '');
    const metaSlug = String(row.meta?.service_slug || row.meta?.serviceSlug || '');
    return slug === serviceKey || metaSlug === serviceKey || slug.includes(serviceKey) || metaSlug.includes(serviceKey);
  });
  if (!matches.length) {
    return { operations: [], warnings };
  }

  const operations = [];
  for (const spec of matches.slice(0, 3)) {
    const slugOrId = spec.slug || spec._id;
    const doc = await gatewayJson(`/api/v1/idp-docs/specs/${encodeURIComponent(slugOrId)}/openapi.json`, cookieHeader);
    if (!doc.ok || !doc.data || typeof doc.data !== 'object') {
      warnings.push({
        code: 'OPENAPI_FETCH_FAILED',
        message: doc.error || `Failed to load openapi for ${slugOrId}`,
      });
      continue;
    }
    operations.push(...expandOpenApiOperations(doc.data, serviceKey));
  }
  return { operations, warnings };
}

async function discoverGatewayApisForService(serviceKey, cookieHeader) {
  const warnings = [];
  if (!cookieHeader) return { operations: [], warnings };
  const prefix = `/api/v1/${serviceKey}`;
  const pageSize = 100;
  let offset = 0;
  let total = Infinity;
  const operations = [];

  while (offset < total && offset < 1000) {
    const page = await gatewayJson('/api/v1/iam/gateway-apis', cookieHeader, {
      query: { path: prefix, limit: pageSize, offset },
    });
    if (!page.ok) {
      warnings.push({
        code: 'GATEWAY_APIS_UNAVAILABLE',
        message: page.error || `gateway-apis failed (${page.status}) — enrichment skipped`,
      });
      break;
    }
    const rows = Array.isArray(page.data?.data) ? page.data.data : [];
    total = Number(page.data?.total ?? rows.length);
    for (const row of rows) {
      const op = operationFromGatewayApi(row, serviceKey);
      if (op) operations.push(op);
    }
    if (!rows.length) break;
    offset += rows.length;
  }

  return { operations, warnings };
}

function mergeOperations(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const op of list) {
      if (!op?.id) continue;
      const existing = byId.get(op.id);
      if (!existing) {
        byId.set(op.id, op);
        continue;
      }
      // Prefer Spec naming; keep enrichment flags
      if (existing.sourceKind === 'SPEC_SERVICE') {
        byId.set(op.id, {
          ...existing,
          sourceKind: op.sourceKind && op.sourceKind !== 'SPEC_SERVICE'
            ? `SPEC_SERVICE+${op.sourceKind}`
            : existing.sourceKind,
          lastSeenAt: op.lastSeenAt || existing.lastSeenAt,
        });
        continue;
      }
      if (existing.sourceKind === 'GATEWAY_API' && op.sourceKind === 'OPENAPI') {
        byId.set(op.id, {
          ...existing,
          ...op,
          sourceKind: 'GATEWAY_API+OPENAPI',
          folderPath: op.folderPath?.length ? op.folderPath : existing.folderPath,
        });
      } else if (op.sourceKind === 'SPEC_SERVICE') {
        byId.set(op.id, {
          ...op,
          sourceKind: existing.sourceKind ? `SPEC_SERVICE+${existing.sourceKind}` : 'SPEC_SERVICE',
          lastSeenAt: existing.lastSeenAt || op.lastSeenAt,
        });
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    String(a.path).localeCompare(String(b.path)) || String(a.method).localeCompare(String(b.method))
  );
}

async function discoverSystemApis(serviceKey, cookieHeader, options = {}) {
  const key = String(serviceKey || options.specFolder || '').trim();
  if (!key) {
    return {
      serviceKey: '',
      operations: [],
      warnings: [{ code: 'SERVICE_REQUIRED', message: 'serviceKey or specFolder is required' }],
      counts: { total: 0, specs: 0, gateway: 0, openapi: 0 },
    };
  }

  const fromDisk = discoverProductApisFromDisk({
    serviceKey: key,
    specFolder: options.specFolder,
    workspaceIndex: options.workspaceIndex,
  });

  const [gateway, openapi] = await Promise.all([
    discoverGatewayApisForService(fromDisk.serviceKey || key, cookieHeader),
    discoverOpenApiForService(fromDisk.serviceKey || key, cookieHeader),
  ]);

  const operations = mergeOperations(fromDisk.operations, gateway.operations, openapi.operations);
  return {
    serviceKey: fromDisk.serviceKey || key,
    applicationId: fromDisk.applicationId || applicationIdForService(key),
    gatewayBaseUrl: gatewayBaseUrl(),
    basePath: fromDisk.basePath || `/api/v1/${key}`,
    product: fromDisk.product,
    operations,
    counts: {
      total: operations.length,
      specs: fromDisk.operations.length,
      gateway: gateway.operations.length,
      openapi: openapi.operations.length,
    },
    warnings: [...fromDisk.warnings, ...gateway.warnings, ...openapi.warnings],
    discoveredAt: new Date().toISOString(),
    source: fromDisk.operations.length ? 'specs-disk' : 'gateway-enrichment',
  };
}

module.exports = {
  IS_APPLICATION_PREFIX,
  applicationIdForService,
  resolveSpecsRoots,
  listWorkspaces,
  listProductsFromDisk,
  discoverProductApisFromDisk,
  discoverSystemsLive,
  discoverSystemApis,
  buildAbsoluteGatewayUrl,
  fingerprintForOperation,
  normalizeGatewayPath,
  resolveGatewayPath,
  workspaceLabelFromRoot,
};
