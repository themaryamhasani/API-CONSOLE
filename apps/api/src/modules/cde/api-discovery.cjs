const { createHash } = require('crypto');
const acorn = require('acorn');
const acornLoose = require('acorn-loose');
const jsx = require('acorn-jsx');

const JsParser = acorn.Parser.extend(jsx());
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function sourceLocation(source, node, metadata = {}) {
  const line = Number(node?.loc?.start?.line || 1);
  const column = Number(node?.loc?.start?.column || 0) + 1;
  const lineText = String(source || '').split(/\r?\n/)[line - 1] || '';
  return {
    repositoryType: metadata.repositoryType,
    packageId: metadata.packId,
    branch: metadata.branch,
    file: metadata.path,
    line,
    column,
    excerpt: lineText.trim().slice(0, 240),
  };
}

function parseJavaScript(source) {
  const options = { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true };
  try {
    return { ast: JsParser.parse(String(source), options), recovered: false };
  } catch (strictError) {
    try {
      return { ast: acornLoose.parse(String(source), options), recovered: true, strictError: strictError.message };
    } catch (looseError) {
      return { ast: null, recovered: false, strictError: strictError.message, error: looseError.message };
    }
  }
}

function walk(node, visitor, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visitor(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visitor, node));
    else if (value && typeof value === 'object' && typeof value.type === 'string') walk(value, visitor, node);
  }
}

function propertyName(node) {
  if (!node) return '';
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  if (node.computed && node.property?.type === 'Literal') return String(node.property.value);
  if (node.type === 'Property') {
    if (!node.computed && node.key?.type === 'Identifier') return node.key.name;
    if (node.key?.type === 'Literal') return String(node.key.value);
  }
  return '';
}

function memberRootName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return `${memberRootName(node.object)}.${propertyName(node)}`;
  if (node.type === 'CallExpression') return memberRootName(node.callee);
  return '';
}

function staticValue(node, constants = new Map(), depth = 0) {
  if (!node || depth > 12) return { known: false };
  if (node.type === 'Literal') return { known: true, value: node.value };
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return { known: true, value: node.quasis.map(item => item.value.cooked ?? item.value.raw).join('') };
  }
  if (node.type === 'Identifier') {
    if (node.name === 'undefined') return { known: true, value: undefined };
    if (constants.has(node.name)) return constants.get(node.name);
    return { known: false };
  }
  if (node.type === 'UnaryExpression' && ['-', '+', '!'].includes(node.operator)) {
    const argument = staticValue(node.argument, constants, depth + 1);
    if (!argument.known) return argument;
    if (node.operator === '-') return { known: true, value: -Number(argument.value) };
    if (node.operator === '+') return { known: true, value: Number(argument.value) };
    return { known: true, value: !argument.value };
  }
  if (node.type === 'ArrayExpression') {
    const values = [];
    for (const element of node.elements) {
      const item = staticValue(element, constants, depth + 1);
      if (!item.known) return { known: false };
      values.push(item.value);
    }
    return { known: true, value: values };
  }
  if (node.type === 'ObjectExpression') {
    const value = {};
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.kind !== 'init' || property.method || property.computed && property.key?.type !== 'Literal') {
        return { known: false };
      }
      const key = property.key.type === 'Identifier' ? property.key.name : String(property.key.value);
      const child = staticValue(property.value, constants, depth + 1);
      if (!child.known) return { known: false };
      value[key] = child.value;
    }
    return { known: true, value };
  }
  return { known: false };
}

function collectConstants(ast) {
  const constants = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    walk(ast, node => {
      if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier' || !node.init || constants.has(node.id.name)) return;
      const value = staticValue(node.init, constants);
      if (value.known) {
        constants.set(node.id.name, value);
        changed = true;
      }
    });
  }
  return constants;
}

function objectField(node, names) {
  if (node?.type !== 'ObjectExpression') return null;
  return node.properties.find(property => property.type === 'Property' && names.includes(propertyName(property)))?.value || null;
}

function normalizeProviderId(value, typeHint) {
  const text = String(value || '').trim().replace(/^\/+/, '');
  if (!text) return '';
  if (text.startsWith('ds/') || text.startsWith('fr/')) return text;
  return typeHint === 'CORE_COMMAND' ? `fr/${text}` : `ds/${text}`;
}

function extractProviderCall(node, constants) {
  if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return null;
  const method = propertyName(node.callee);
  if (!['ds', 'fr'].includes(method)) return null;
  const type = method === 'fr' ? 'CORE_COMMAND' : 'CORE_QUERY';
  const first = node.arguments[0];
  let idNode = first;
  let payloadNode = node.arguments[1];
  if (first?.type === 'ObjectExpression') {
    idNode = objectField(first, method === 'fr' ? ['formId', 'provider'] : ['key', 'provider']);
    payloadNode = objectField(first, method === 'fr' ? ['data'] : ['params']);
  }
  const id = staticValue(idNode, constants);
  const payload = staticValue(payloadNode, constants);
  if (!id.known || typeof id.value !== 'string') return null;
  return {
    type,
    sourceId: normalizeProviderId(id.value, type),
    payload: payload.known && payload.value && typeof payload.value === 'object' ? payload.value : {},
    payloadKnown: payload.known,
  };
}

function extractSendDataCall(node, constants) {
  if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression' || propertyName(node.callee) !== 'sendData') return null;
  const endpoint = staticValue(node.arguments[0], constants);
  const payloadNode = node.arguments[1];
  if (!endpoint.known || typeof endpoint.value !== 'string' || payloadNode?.type !== 'ObjectExpression') return null;
  let type;
  if (endpoint.value.includes('get-data-source')) type = 'CORE_QUERY';
  if (endpoint.value.includes('store-form-data')) type = 'CORE_COMMAND';
  if (!type) return null;
  const idNode = objectField(payloadNode, type === 'CORE_COMMAND' ? ['formId'] : ['key']);
  const dataNode = objectField(payloadNode, type === 'CORE_COMMAND' ? ['data'] : ['params']);
  const id = staticValue(idNode, constants);
  const payload = staticValue(dataNode, constants);
  if (!id.known || typeof id.value !== 'string') return null;
  return {
    type,
    sourceId: normalizeProviderId(id.value, type),
    payload: payload.known && payload.value && typeof payload.value === 'object' ? payload.value : {},
    payloadKnown: payload.known,
  };
}

function analyzeJavaScriptFile(file, metadata) {
  const source = String(file.code || '');
  const parsed = parseJavaScript(source);
  const result = { serviceIds: [], providerCalls: [], routes: [], explicitExamples: [], explicitSchemas: [], warnings: [] };
  if (!parsed.ast) {
    result.warnings.push({
      code: 'SOURCE_PARSE_FAILED',
      message: `Static parser could not read ${file.path}.`,
      evidence: { ...metadata, path: file.path },
    });
    return result;
  }
  if (parsed.recovered) {
    result.warnings.push({
      code: 'SOURCE_PARSE_RECOVERED',
      message: `Static parser recovered syntax in ${file.path}; dynamic expressions remain unresolved.`,
      evidence: { ...metadata, path: file.path },
    });
  }
  const constants = collectConstants(parsed.ast);
  walk(parsed.ast, (node, parent) => {
    let serviceValueNode = null;
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression' && propertyName(node.left) === 'APP_RAYA_SERVICE_ID') {
      serviceValueNode = node.right;
    } else if (node.type === 'Property' && propertyName(node) === 'APP_RAYA_SERVICE_ID') {
      serviceValueNode = node.value;
    } else if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.id.name === 'APP_RAYA_SERVICE_ID') {
      serviceValueNode = node.init;
    }
    if (serviceValueNode) {
      const value = staticValue(serviceValueNode, constants);
      if (value.known && typeof value.value === 'string' && value.value.trim()) {
        result.serviceIds.push({ value: value.value.trim(), evidence: sourceLocation(source, node, { ...metadata, path: file.path }) });
      } else {
        result.warnings.push({ code: 'SERVICE_ID_DYNAMIC', message: 'APP_RAYA_SERVICE_ID is dynamic and was not executed.', evidence: sourceLocation(source, node, { ...metadata, path: file.path }) });
      }
    }

    if (node.type === 'Property' && ['example', 'requestExample', 'payloadExample'].includes(propertyName(node))) {
      const value = staticValue(node.value, constants);
      if (value.known && value.value && typeof value.value === 'object' && !Array.isArray(value.value)) {
        result.explicitExamples.push({ value: value.value, evidence: sourceLocation(source, node, { ...metadata, path: file.path }) });
      }
    }
    if (node.type === 'Property' && ['schema', 'requestSchema'].includes(propertyName(node))) {
      const value = staticValue(node.value, constants);
      if (value.known && value.value && typeof value.value === 'object' && !Array.isArray(value.value)) {
        result.explicitSchemas.push({ value: value.value, evidence: sourceLocation(source, node, { ...metadata, path: file.path }) });
      }
    }

    const call = extractProviderCall(node, constants) || extractSendDataCall(node, constants);
    if (call) result.providerCalls.push({ ...call, evidence: sourceLocation(source, node, { ...metadata, path: file.path }) });

    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const method = propertyName(node.callee).toLowerCase();
      const routeReceiver = memberRootName(node.callee.object);
      if (HTTP_METHODS.has(method) && /(?:^|\.)(?:router|app|server|route)/i.test(routeReceiver)) {
        const route = staticValue(node.arguments[0], constants);
        if (route.known && typeof route.value === 'string' && route.value.startsWith('/')) {
          result.routes.push({ method: method.toUpperCase(), path: route.value, evidence: sourceLocation(source, node, { ...metadata, path: file.path }) });
        } else if (node.arguments[0]) {
          result.warnings.push({ code: 'DATA_SERVICE_DYNAMIC_ROUTE', message: 'A dynamic Data Service route was ignored.', evidence: sourceLocation(source, node, { ...metadata, path: file.path }) });
        }
      }
    }
  });
  return result;
}

function parseOpenApiFile(file, metadata) {
  const fileName = String(file.path || '').toLowerCase();
  if (!fileName.endsWith('swagger.json') && !fileName.endsWith('swagger.json.config') && !fileName.endsWith('openapi.json')) return null;
  let document;
  try {
    document = JSON.parse(String(file.code || '').replace(/^\uFEFF/, ''));
  } catch {
    const parsed = parseJavaScript(String(file.code || ''));
    if (parsed.ast) {
      let candidate;
      const constants = collectConstants(parsed.ast);
      walk(parsed.ast, node => {
        if (candidate) return;
        if (node.type === 'AssignmentExpression' &&
          (propertyName(node.left) === 'exports' || node.left?.type === 'MemberExpression' && propertyName(node.left) === 'exports')) {
          const value = staticValue(node.right, constants);
          if (value.known) candidate = value.value;
        }
        if (!candidate && node.type === 'ObjectExpression') {
          const value = staticValue(node, constants);
          if (value.known && value.value?.paths && typeof value.value.paths === 'object') candidate = value.value;
        }
      });
      document = candidate;
    }
  }
  if (!document || typeof document !== 'object' || !document.paths || typeof document.paths !== 'object') {
    return { operations: [], warning: { code: 'DATA_SERVICE_OPENAPI_INVALID', message: `${file.path} is not a statically readable OpenAPI document.`, evidence: { ...metadata, path: file.path } } };
  }
  const operations = [];
  for (const [routePath, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      operations.push({
        method: method.toUpperCase(),
        path: routePath,
        summary: operation?.summary || operation?.operationId || `${method.toUpperCase()} ${routePath}`,
        operationId: operation?.operationId,
        requestSchema: operation?.requestBody?.content?.['application/json']?.schema,
        requestExample: operation?.requestBody?.content?.['application/json']?.example,
        evidence: { ...metadata, path: file.path, line: 1, column: 1, excerpt: `OpenAPI ${method.toUpperCase()} ${routePath}` },
      });
    }
  }
  return { operations };
}

function stableOperationId(projectKey, sourceKind, sourceId, method = '') {
  return `runtime-op-${sha256([projectKey, sourceKind, sourceId, method].join('|')).slice(0, 24)}`;
}

function fingerprintOperation(operation) {
  return sha256(JSON.stringify({
    sourceKind: operation.sourceKind,
    sourceId: operation.sourceId,
    type: operation.type,
    method: operation.method,
    path: operation.path,
    payloadExample: operation.payloadExample,
    schema: operation.schema,
    sourceRevisionFingerprint: operation.sourceRevisionFingerprint,
  }));
}

function discoverProjectSources(projectKey, repositorySources) {
  const serviceIds = [];
  const providerCalls = [];
  const dataServiceOpenApi = [];
  const dataServiceRoutes = [];
  const moduleExamples = new Map();
  const moduleSchemas = new Map();
  const warnings = [];
  const apiModules = [];

  for (const sourcePackage of repositorySources || []) {
    const metadata = {
      repositoryType: sourcePackage.repositoryType,
      packId: sourcePackage.packId,
      branch: sourcePackage.branch,
    };
    if (sourcePackage.repositoryType === 'API_MODULE') {
      const sourceId = String(sourcePackage.packId || '').trim();
      if (sourceId.startsWith('ds/') || sourceId.startsWith('fr/')) {
        apiModules.push({
          sourceId,
          metadata,
          contentFingerprint: sha256((sourcePackage.files || []).map(file => `${file.path}\0${file.code}`).join('\0')),
        });
      }
      else warnings.push({ code: 'API_MODULE_PREFIX_UNSUPPORTED', message: `API module ${sourceId || '(empty)'} does not start with ds/ or fr/ and was ignored.`, evidence: metadata });
    }
    for (const file of sourcePackage.files || []) {
      if (sourcePackage.repositoryType === 'DATA_SERVICE') {
        const openApi = parseOpenApiFile(file, metadata);
        if (openApi) {
          dataServiceOpenApi.push(...openApi.operations);
          if (openApi.warning) warnings.push(openApi.warning);
        }
      }
      if (/\.(?:[cm]?js|jsx|ts|tsx)$/i.test(file.path || '') || sourcePackage.repositoryType === 'API_MODULE') {
        const analyzed = analyzeJavaScriptFile(file, metadata);
        serviceIds.push(...analyzed.serviceIds);
        providerCalls.push(...analyzed.providerCalls);
        if (sourcePackage.repositoryType === 'API_MODULE' && analyzed.explicitExamples[0] && !moduleExamples.has(sourcePackage.packId)) moduleExamples.set(sourcePackage.packId, analyzed.explicitExamples[0]);
        if (sourcePackage.repositoryType === 'API_MODULE' && analyzed.explicitSchemas[0] && !moduleSchemas.has(sourcePackage.packId)) moduleSchemas.set(sourcePackage.packId, analyzed.explicitSchemas[0]);
        if (sourcePackage.repositoryType === 'DATA_SERVICE') dataServiceRoutes.push(...analyzed.routes);
        warnings.push(...analyzed.warnings);
      }
    }
  }

  const callMap = new Map();
  providerCalls.forEach(call => {
    if (!callMap.has(call.sourceId) || call.payloadKnown) callMap.set(call.sourceId, call);
  });
  const moduleMap = new Map();
  apiModules.forEach(module => {
    if (!moduleMap.has(module.sourceId)) moduleMap.set(module.sourceId, { ...module, evidence: [module.metadata], contentFingerprints: [module.contentFingerprint] });
    else {
      moduleMap.get(module.sourceId).evidence.push(module.metadata);
      moduleMap.get(module.sourceId).contentFingerprints.push(module.contentFingerprint);
    }
  });
  const operations = [];
  for (const [sourceId, module] of moduleMap) {
    const call = callMap.get(sourceId);
    const explicitExample = moduleExamples.get(sourceId);
    const explicitSchema = moduleSchemas.get(sourceId);
    const type = sourceId.startsWith('fr/') ? 'CORE_COMMAND' : 'CORE_QUERY';
    const operation = {
      id: stableOperationId(projectKey, 'API_MODULE', sourceId),
      projectKey,
      sourceKind: 'API_MODULE',
      sourceId,
      moduleId: sourceId,
      type,
      name: sourceId,
      payloadExample: call?.payloadKnown ? call.payload : explicitExample?.value || {},
      schema: explicitSchema?.value,
      schemaCompleteness: call?.payloadKnown || explicitExample ? 'COMPLETE' : 'NEEDS_INPUT',
      evidence: [...module.evidence, ...(call ? [call.evidence] : []), ...(explicitExample ? [explicitExample.evidence] : []), ...(explicitSchema ? [explicitSchema.evidence] : [])],
      sourceRevisionFingerprint: sha256(module.contentFingerprints.sort().join('|')),
    };
    operation.sourceFingerprint = fingerprintOperation(operation);
    operations.push(operation);
  }

  const openApiKeys = new Set();
  dataServiceOpenApi.forEach(item => {
    const key = `${item.method} ${item.path}`;
    if (openApiKeys.has(key)) return;
    openApiKeys.add(key);
    const operation = {
      id: stableOperationId(projectKey, 'DATA_SERVICE', item.path, item.method),
      projectKey,
      sourceKind: 'DATA_SERVICE',
      sourceId: key,
      type: 'REST',
      method: item.method,
      path: item.path,
      name: item.summary,
      operationId: item.operationId,
      payloadExample: item.requestExample || {},
      schema: item.requestSchema,
      schemaCompleteness: item.requestSchema || item.requestExample ? 'COMPLETE' : 'NEEDS_INPUT',
      evidence: [item.evidence],
    };
    operation.sourceFingerprint = fingerprintOperation(operation);
    operations.push(operation);
  });
  dataServiceRoutes.forEach(item => {
    const key = `${item.method} ${item.path}`;
    if (openApiKeys.has(key)) return;
    openApiKeys.add(key);
    const operation = {
      id: stableOperationId(projectKey, 'DATA_SERVICE', item.path, item.method),
      projectKey,
      sourceKind: 'DATA_SERVICE',
      sourceId: key,
      type: 'REST',
      method: item.method,
      path: item.path,
      name: key,
      payloadExample: {},
      schemaCompleteness: 'NEEDS_INPUT',
      evidence: [item.evidence],
    };
    operation.sourceFingerprint = fingerprintOperation(operation);
    operations.push(operation);
  });

  const candidates = new Map();
  serviceIds.forEach(item => {
    if (!candidates.has(item.value)) candidates.set(item.value, []);
    candidates.get(item.value).push(item.evidence);
  });
  const projectServiceIdCandidates = Array.from(candidates, ([value, evidence]) => ({ value, evidence }));
  const serviceIdStatus = projectServiceIdCandidates.length === 1 ? 'RESOLVED' : projectServiceIdCandidates.length ? 'CONFLICT' : 'MISSING';
  if (serviceIdStatus === 'CONFLICT') warnings.push({ code: 'SERVICE_ID_CONFLICT', message: 'Multiple APP_RAYA_SERVICE_ID values were discovered; a System Administrator must select one.' });
  if (serviceIdStatus === 'MISSING') warnings.push({ code: 'SERVICE_ID_MISSING', message: 'APP_RAYA_SERVICE_ID was not found; a System Administrator must configure evidence before execution.' });

  return {
    projectKey,
    parserVersion: 'cde-static-discovery/1.0.0',
    serviceIdStatus,
    projectServiceIdCandidates,
    operations,
    warnings,
    stats: {
      sourcePackages: (repositorySources || []).length,
      apiModules: moduleMap.size,
      providerCallsites: providerCalls.length,
      dataServiceOperations: operations.filter(item => item.sourceKind === 'DATA_SERVICE').length,
    },
  };
}

module.exports = {
  analyzeJavaScriptFile,
  discoverProjectSources,
  parseJavaScript,
  staticValue,
};
