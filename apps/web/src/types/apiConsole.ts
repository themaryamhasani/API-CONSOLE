import type { PaginatedResponse, UserRole } from './index';
export type ApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ApiBodyType = 'none' | 'json' | 'raw' | 'xml' | 'form-urlencoded' | 'multipart' | 'binary';
export type ApiExecutionMode = 'RECOMMENDED' | 'EXACT';
export type ApiClassificationType = 'GENERIC_HTTP' | 'CORE_QUERY' | 'CORE_COMMAND';
export type ApiCoreOperationType = 'QUERY' | 'COMMAND';
export type ApiSharingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'RETURNED' | 'APPROVED' | 'DEPRECATED';
export type ApiRequestSourceType = 'ORIGINAL' | 'REFERENCE' | 'CDE_DISCOVERY' | 'IS_DISCOVERY';
/** Reserved applicationId for free-form / personal requests (not bound to a CDE system). */
export const PERSONAL_APPLICATION_ID = 'PERSONAL';
export const PERSONAL_APPLICATION_LABEL = 'شخصی / آزاد';
export type ApiConsumerType = 'USER' | 'ROLE';
export type ApiShareReviewAction = 'APPROVED' | 'RETURNED';
export type ApiUsageEventType = 'ADDED_TO_CONSOLE' | 'API_OPENED' | 'API_EXECUTED' | 'REMOVED_FROM_CONSOLE' | 'NEW_VERSION_VIEWED';
export type ApiAuthType = 'none' | 'bearer' | 'basic' | 'api-key' | 'cookie-session' | 'custom-headers' | 'environment-secret';
export type ApiHeaderCategory = 'USER_BUSINESS' | 'BROWSER_GENERATED' | 'TRANSPORT_GENERATED' | 'AUTHENTICATION' | 'ENVIRONMENT';
export type ApiValueSource = 'IMPORTED_CURL' | 'USER' | 'ENVIRONMENT' | 'SYSTEM' | 'AUTHENTICATION';
export type ApiEnvironmentKind = 'DEVELOPMENT' | 'TEST' | 'PRE_PRODUCTION' | 'PRODUCTION' | 'CUSTOM';
export type ApiExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'BLOCKED';
export type ApiTransportResult = 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
export type ApiBusinessResult = 'PASSED' | 'FAILED' | 'WARNING' | 'NOT_EVALUATED';
export type ApiResponseEvidenceType = 'ACTUAL_EXECUTION' | 'IMPORTED_EVIDENCE' | 'MANUAL_EXAMPLE';
export type ApiCurlDialect = 'BASH' | 'LINUX_MAC' | 'WINDOWS_CMD' | 'POWERSHELL' | 'CHROME_EDGE' | 'UNKNOWN';
export type ApiExportDialect = 'bash' | 'windows-cmd' | 'powershell';
export type ApiErrorCategory = 'CURL_PARSE_ERROR' | 'INVALID_URL' | 'UNSUPPORTED_CURL_OPTION' | 'VARIABLE_RESOLUTION_ERROR' | 'SECRET_RESOLUTION_ERROR' | 'AUTHENTICATION_ERROR' | 'DNS_ERROR' | 'TLS_ERROR' | 'CONNECTION_TIMEOUT' | 'READ_TIMEOUT' | 'RESPONSE_TOO_LARGE' | 'REDIRECT_BLOCKED' | 'DESTINATION_NOT_ALLOWED' | 'CORE_VALIDATION_ERROR' | 'HTTP_ERROR' | 'EXECUTION_CANCELLED' | 'INTERNAL_EXECUTION_ERROR';
export const API_SHARING_STATUS_LABELS: Record<ApiSharingStatus, string> = {
    DRAFT: 'پیش‌نویس',
    PENDING_REVIEW: 'در انتظار بررسی',
    RETURNED: 'بازگردانده‌شده',
    APPROVED: 'تأییدشده',
    DEPRECATED: 'منسوخ‌شده',
};
export interface ApiVariable {
    id: string;
    key: string;
    currentValue: string;
    initialValue?: string | undefined;
    sensitive: boolean;
    scope: 'GLOBAL' | 'ENVIRONMENT' | 'COLLECTION' | 'REQUEST' | 'EXECUTION';
    description?: string | undefined;
}
export interface ApiEnvironmentProfile {
    id: string;
    name: string;
    kind: ApiEnvironmentKind;
    baseUrl: string;
    variables: ApiVariable[];
    defaultHeaders: ApiRequestHeader[];
    secretReferences: Record<string, string>;
    productionProtected: boolean;
    archived?: boolean | undefined;
    seeded?: boolean | undefined;
    clonedFrom?: string | undefined;
    authenticationDocumentationProfileId?: string | undefined;
    runnerId?: string | undefined;
    webhookUrl?: string | undefined;
    webhookSecret?: string | undefined;
    createdAt: string;
    updatedAt: string;
}
export interface ApiClassification {
    type: ApiClassificationType;
    serviceId: string | null;
    operationPath: string | null;
    coreOperationType: ApiCoreOperationType | null;
    endpoint: string | null;
}
export interface ApiRequestBody {
    type: ApiBodyType;
    value: unknown;
    raw: string;
    contentType?: string | undefined;
    fileName?: string | undefined;
}
export interface ApiRequestAuthentication {
    type: ApiAuthType;
    bearerTokenReference?: string | undefined;
    basicUsername?: string | undefined;
    basicPasswordReference?: string | undefined;
    apiKeyName?: string | undefined;
    apiKeyValueReference?: string | undefined;
    cookieName?: string | undefined;
    cookieValueReference?: string | undefined;
    customHeaderReferences?: Array<{
        name: string;
        valueReference: string;
    }> | undefined;
}
export interface ApiTlsSettings {
    verifyCertificate: boolean;
    importedInsecureFlag?: boolean | undefined;
}
export interface ApiRequestHeader {
    id: string;
    name: string;
    valueTemplate: string;
    enabled: boolean;
    sensitive: boolean;
    source: ApiValueSource;
    category: ApiHeaderCategory;
    description: string;
    maskedValue: string;
    displayOrder: number;
    cannotTransmitExactly?: boolean | undefined;
    replayNote?: string | undefined;
}
export interface ApiRequestCookie {
    id: string;
    name: string;
    valueReference: string;
    enabled: boolean;
    sensitive: boolean;
    maskedValue: string;
    domain?: string | undefined;
    path?: string | undefined;
    expiresAt?: string | undefined;
    source: ApiValueSource;
    displayOrder: number;
    temporary?: boolean | undefined;
}
export interface ApiKeyValueParameter {
    id: string;
    name: string;
    value: string;
    enabled: boolean;
    sensitive?: boolean | undefined;
    source?: ApiValueSource | undefined;
    description?: string | undefined;
    displayOrder: number;
}
export interface NormalizedApiRequest {
    method: ApiHttpMethod;
    url: string;
    queryParameters: ApiKeyValueParameter[];
    headers: ApiRequestHeader[];
    cookies: ApiRequestCookie[];
    body: ApiRequestBody;
    authentication: ApiRequestAuthentication;
    tls: ApiTlsSettings;
    executionMode: ApiExecutionMode;
    classification: ApiClassification;
}
export interface ApiSecretScanResult {
    findings: string[];
    mode: string;
    blocked?: boolean | undefined;
    warnings?: string[] | undefined;
}

export interface ApiCurlImportPreview {
    id: string;
    originalCurl: string;
    detectedDialect: ApiCurlDialect;
    normalizedRequest: NormalizedApiRequest;
    effectiveMethod: ApiHttpMethod;
    url: string;
    headerCount: number;
    cookieCount: number;
    bodyType: ApiBodyType;
    jsonValidity: {
        valid: boolean;
        error?: string | undefined;
        line?: number | undefined;
        column?: number | undefined;
    };
    tlsVerification: boolean;
    warnings: string[];
    unsupportedOptions: string[];
    parserVersion: string;
    importedAt: string;
    secretScan?: ApiSecretScanResult | undefined;
}
export type ApiVisibility = 'PRIVATE' | 'PROJECT_SHARED';

export interface ApiCollection {
    id: string;
    applicationId: string;
    workspaceName: string;
    name: string;
    description?: string | undefined;
    ownerId: string;
    status: 'ACTIVE' | 'ARCHIVED';
    visibility?: ApiVisibility | undefined;
    variables: ApiVariable[];
    authenticationDocumentationProfileId?: string | undefined;
    createdAt: string;
    updatedAt: string;
}
export interface ApiPostmanCollectionExport {
    fileName: string;
    requestCount: number;
    collection: Record<string, unknown>;
}
export interface ApiRequestAssertion {
    id: string;
    assertionType: 'EXPECTED_HTTP_STATUS' | 'MAX_RESPONSE_TIME' | 'EXPECTED_CONTENT_TYPE' | 'REQUIRED_JSON_PATH' | 'HEADER_VALUE' | 'BUSINESS_EXPRESSION' | 'JSON_SCHEMA';
    configuration: Record<string, unknown>;
    enabled: boolean;
    lastResult?: ApiBusinessResult | undefined;
    lastMessage?: string | undefined;
}
export interface ApiRequestScripts {
    preRequest: string;
    postResponse: string;
    preRequestEnabled: boolean;
    postResponseEnabled: boolean;
}
export type ApiDocumentationParameterLocation = 'HEADER' | 'QUERY' | 'PATH' | 'BODY' | 'RESPONSE';
export interface ApiDocumentationAllowedValue {
    id: string;
    value: string;
    description: string;
    enabled: boolean;
    displayOrder: number;
}
export interface ApiDocumentationParameter {
    id: string;
    name: string;
    location: ApiDocumentationParameterLocation;
    dataType: string;
    required: boolean | null;
    description: string;
    exampleValue?: string | undefined;
    parentPath?: string | undefined;
    displayOrder: number;
    enabled?: boolean | undefined;
    deprecated?: boolean | undefined;
    source?: 'AUTO' | 'MANUAL' | 'PROFILE' | string | undefined;
    allowedValues?: ApiDocumentationAllowedValue[] | undefined;
    allowedValuesCustomized?: boolean | undefined;
}
export interface ApiDocumentationResponseCode {
    code: number;
    message: string;
    description: string;
    enabled: boolean;
    displayOrder: number;
}
export interface ApiAuthenticationDocumentation {
    profileId?: string | undefined;
    enabled: boolean;
    title: string;
    introduction: string;
    baseUrl: string;
    endpoint: string;
    method: string;
    contentType: string;
    headerParameters?: ApiDocumentationParameter[] | undefined;
    inputParameters: ApiDocumentationParameter[];
    outputParameters: ApiDocumentationParameter[];
    curlExample?: string | undefined;
    responseExample?: string | undefined;
}
export interface ApiAuthenticationDocumentationProfile extends ApiAuthenticationDocumentation {
    id: string;
}
export interface ApiDocumentationMetadata {
    title: string;
    description: string;
    serviceIntroduction?: string | undefined;
    baseUrl?: string | undefined;
    operationPath?: string | undefined;
    endpoint?: string | undefined;
    method?: string | undefined;
    headerParameters?: ApiDocumentationParameter[] | undefined;
    inputParameters?: ApiDocumentationParameter[] | undefined;
    outputParameters?: ApiDocumentationParameter[] | undefined;
    authenticationProfileId?: string | undefined;
    authenticationDocumentation?: ApiAuthenticationDocumentation | undefined;
    responseCodes?: ApiDocumentationResponseCode[] | undefined;
    organizationName?: string | undefined;
    departmentName?: string | undefined;
    documentRevision?: string | undefined;
    documentDate?: string | undefined;
    curlExample?: string | undefined;
    responseExample?: string | undefined;
    providerApplication?: string | undefined;
    consumerApplications?: string[] | undefined;
    version?: string | undefined;
    owner?: string | undefined;
    supportContact?: string | undefined;
    changeHistory?: Array<{
        version: string;
        changedAt: string;
        summary: string;
    }> | undefined;
}
export interface ApiRequestDefinition {
    id: string;
    collectionId: string;
    applicationId: string;
    apiId: string;
    semanticVersion: string;
    sharingStatus: ApiSharingStatus;
    sourceType: ApiRequestSourceType;
    referenceId?: string | undefined;
    sourceRequestId?: string | undefined;
    shareRequestId?: string | undefined;
    latestReturnReason?: string | undefined;
    approvedAt?: string | undefined;
    approvedBy?: string | undefined;
    name: string;
    description?: string | undefined;
    method: ApiHttpMethod;
    urlTemplate: string;
    folderPath?: string[] | undefined;
    queryParameters: ApiKeyValueParameter[];
    headers: ApiRequestHeader[];
    cookies: ApiRequestCookie[];
    bodyType: ApiBodyType;
    bodyTemplate: string;
    authentication: ApiRequestAuthentication;
    tls: ApiTlsSettings;
    executionMode: ApiExecutionMode;
    classification: ApiClassification;
    environmentId: string;
    assertions: ApiRequestAssertion[];
    scripts: ApiRequestScripts;
    documentation: ApiDocumentationMetadata;
    version: number;
    status: 'ACTIVE' | 'ARCHIVED';
    originalImportedCurl?: string | undefined;
    importedCurlId?: string | undefined;
    createdBy: string;
    createdAt: string;
    updatedBy?: string | undefined;
    updatedAt: string;
    runtimeBinding?: RuntimeBinding | undefined;
    isGatewayBinding?: IsGatewayBinding | undefined;
    sourceSync?: SourceSyncState | undefined;
    schemaCompleteness?: 'COMPLETE' | 'NEEDS_INPUT' | undefined;
    sourceEvidence?: SourceEvidence[] | undefined;
    visibility?: ApiVisibility | undefined;
    coOwnerIds?: string[] | undefined;
    ownerId?: string | undefined;
    runnerId?: string | undefined;
    breakingChange?: boolean | undefined;
    migrationNote?: string | undefined;
    deprecatedAt?: string | undefined;
    deprecationReason?: string | undefined;
    deprecationEffectiveAt?: string | undefined;
    ticketId?: string | undefined;
    ticketUrl?: string | undefined;
}

export type RuntimeEnvironmentKind = 'DEVELOPMENT' | 'TEST' | 'PRE_PRODUCTION' | 'PRODUCTION';
export type RuntimeSessionPhase = 'DISCONNECTED' | 'STARTING' | 'PASSWORD_REQUIRED' | 'CONNECTED';
export type DiscoveryPreviewState = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'REMOVED';

export interface SourceEvidence {
    repositoryType?: 'WEB_UI' | 'API_MODULE' | 'DATA_SERVICE' | string | undefined;
    packageId?: string | undefined;
    branch?: Record<string, unknown> | undefined;
    file?: string | undefined;
    path?: string | undefined;
    line?: number | undefined;
    column?: number | undefined;
    excerpt?: string | undefined;
}

export interface RuntimeProfile {
    id: string;
    applicationId: string;
    projectKey: string;
    name: string;
    kind: RuntimeEnvironmentKind;
    origin: string;
    coreBasePath: string;
    loginPath: string;
    appRefererPath: string;
    runtimeServiceId: string;
    projectServiceId?: string | undefined;
    serviceIdEvidence: SourceEvidence[];
    serviceIdApprovedAt?: string | undefined;
    serviceIdApprovedBy?: string | undefined;
    userSource: string;
    prostage?: string | undefined;
    dataService: {
        baseUrl: string;
        authMode: 'NONE' | 'BEARER' | 'BASIC' | 'TOKEN_ENDPOINT';
        username?: string | undefined;
        tokenPath?: string | undefined;
        executionEnabled: boolean;
        authConfigured: boolean;
    };
    enabled: boolean;
    rowVersion: string;
    lastValidatedAt?: string | undefined;
    lastValidation?: { valid: boolean; addresses: string[]; checkedAt: string } | undefined;
    createdAt: string;
    updatedAt: string;
}

export interface RuntimeSessionStatus {
    connected: boolean;
    phase: RuntimeSessionPhase;
    profileId: string;
    nextStep?: 'password' | undefined;
    loginName?: string | undefined;
    runtimeUser?: { username?: string; firstName?: string; lastName?: string } | null | undefined;
    ecreq?: boolean | undefined;
    connectedAt?: string | undefined;
    lastUsedAt?: string | undefined;
}

export interface DiscoveredOperation {
    id: string;
    projectKey: string;
    sourceKind: 'API_MODULE' | 'DATA_SERVICE';
    sourceId: string;
    moduleId?: string | undefined;
    type: 'CORE_QUERY' | 'CORE_COMMAND' | 'REST';
    method?: ApiHttpMethod | undefined;
    path?: string | undefined;
    name: string;
    payloadExample: Record<string, unknown>;
    schema?: Record<string, unknown> | undefined;
    schemaCompleteness: 'COMPLETE' | 'NEEDS_INPUT';
    evidence: SourceEvidence[];
    sourceFingerprint: string;
    previewState: DiscoveryPreviewState;
}

export interface ApiDiscoverySnapshot {
    id: string;
    projectKey: string;
    applicationId: string;
    status: 'READY' | 'BLOCKED_SERVICE_ID';
    parserVersion: string;
    serviceIdStatus: 'RESOLVED' | 'CONFLICT' | 'MISSING';
    projectServiceIdCandidates: Array<{ value: string; evidence: SourceEvidence[] }>;
    operations: DiscoveredOperation[];
    removedOperations: DiscoveredOperation[];
    warnings: Array<{ code: string; message: string; evidence?: SourceEvidence }>;
    stats: Record<string, number>;
    sourceFingerprint: string;
    scannedBy: string;
    createdAt: string;
}

export interface RuntimeBinding {
    runtimeProfileId: string;
    projectKey: string;
    projectServiceId?: string | undefined;
    sourceKind: 'API_MODULE' | 'DATA_SERVICE';
    operationId: string;
    moduleId?: string | undefined;
    sourceFingerprint: string;
    requiresRuntimeSession: boolean;
}

/** Binding for Integrated Systems Gateway executions (cookie `_lsr` injected server-side). */
export interface IsGatewayBinding {
    approach: 'IS';
    sourceKind: string;
    sourceFingerprint: string;
    serviceKey: string;
    gatewayPath: string;
    gatewayBaseUrl: string;
    applicationId: string;
    specFolder?: string | null;
    controllerName?: string | null;
    actionName?: string | null;
    requiresIsSession: true;
    /** Cookie / session secrets are never stored on the request; backend injects `_lsr`. */
    secretsInjectedAtExecute: true;
}

export interface SourceSyncState {
    status: 'SYNCED' | 'CONFLICT' | 'STALE';
    sourceFingerprint: string;
    baseDefinition?: Record<string, unknown> | undefined;
    incomingDefinition?: Record<string, unknown> | undefined;
    conflicts: Array<{ field: string; base: unknown; local: unknown; incoming: unknown }>;
    syncedAt?: string | undefined;
    staleAt?: string | undefined;
    syncedBy?: string | undefined;
}

export interface DiscoverySyncResult {
    created: string[];
    updated: string[];
    unchanged: string[];
    conflicts: Array<{ requestId: string; conflicts: SourceSyncState['conflicts'] }>;
    stale: string[];
}

export interface RuntimeCurlExport {
    fileName: string;
    mode: 'sample' | 'bundle';
    value: string;
    helperFileName?: string | undefined;
    ecreqHelper?: string | undefined;
    note?: string | undefined;
}
export interface ApiVersionConsumer {
    id: string;
    apiId: string;
    version: string;
    consumerType: ApiConsumerType;
    userId?: string | undefined;
    roleKey?: UserRole | undefined;
    applicationId: string;
    status: 'ACTIVE' | 'REVOKED';
    createdBy: string;
    createdAt: string;
    updatedBy?: string | undefined;
    updatedAt?: string | undefined;
}
export interface ApiShareRevision {
    id: string;
    shareRequestId: string;
    revisionNumber: number;
    purpose: string;
    introduction: string;
    description: string;
    snapshot: Record<string, unknown>;
    submittedBy: string;
    submittedAt: string;
    status: ApiSharingStatus;
    reviewedBy?: string | undefined;
    reviewedAt?: string | undefined;
    reviewAction?: ApiShareReviewAction | undefined;
    returnReason?: string | undefined;
    documentationReference?: string | undefined;
    rowVersion: string;
}
export interface ApiReviewChecklist {
    docsComplete: boolean;
    noSecrets: boolean;
    classificationOk: boolean;
    consumersSpecified: boolean;
}

export interface ApiShareComment {
    id: string;
    authorId: string;
    authorName?: string | undefined;
    text: string;
    createdAt: string;
}

export interface ApiShareRequest {
    id: string;
    requestId: string;
    apiId: string;
    apiTitle: string;
    applicationId: string;
    version: string;
    submittedBy: string;
    submittedByName?: string | undefined;
    status: ApiSharingStatus;
    currentRevisionNumber: number;
    purpose?: string | undefined;
    introduction?: string | undefined;
    description?: string | undefined;
    ticketId?: string | undefined;
    ticketUrl?: string | undefined;
    returnReason?: string | undefined;
    reviewedBy?: string | undefined;
    reviewedAt?: string | undefined;
    revisions: ApiShareRevision[];
    comments?: ApiShareComment[] | undefined;
    checklist?: ApiReviewChecklist | undefined;
    rowVersion: string;
    createdAt: string;
    updatedAt: string;
    request?: ApiRequestDefinition | undefined;
    consumers?: ApiVersionConsumer[] | undefined;
}
export interface ApiConsumerCandidate {
    id: string;
    consumerType: ApiConsumerType;
    userId?: string | undefined;
    roleKey?: UserRole | undefined;
    applicationId?: string | undefined;
    label: string;
    description?: string | undefined;
}
export interface ApiConsoleDirectoryUser {
    id: string;
    fullName: string;
    phoneNumber?: string | undefined;
    email?: string | undefined;
    source: 'CDE' | string;
    isActive: boolean;
    roles: UserRole[];
    isSystemAdmin: boolean;
    isBootstrapAdmin: boolean;
    isBootstrapQaLead?: boolean | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
}
export interface ApiRepositoryItem {
    id: string;
    apiId: string;
    requestId: string;
    title: string;
    description?: string | undefined;
    applicationId: string;
    version: string;
    method: ApiHttpMethod;
    urlTemplate: string;
    classification: ApiClassification;
    sharingStatus: ApiSharingStatus;
    ownerId: string;
    approvedAt?: string | undefined;
    consumers: ApiVersionConsumer[];
    referenceId?: string | undefined;
    referenceRequestId?: string | undefined;
    hasNewerVersion: boolean;
    latestVersion: string;
    isNewForUser: boolean;
    changeLog?: string | undefined;
    breakingChange?: boolean | undefined;
    migrationNote?: string | undefined;
    deprecationReason?: string | undefined;
    ticketId?: string | undefined;
    ticketUrl?: string | undefined;
    createdAt: string;
    updatedAt: string;
    request?: ApiRequestDefinition | undefined;
    shareRequest?: ApiShareRequest | undefined;
    executions?: ApiRequestExecution[] | undefined;
    manualResponses?: ApiManualResponseExample[] | undefined;
}

export type ApiDocLanguage = 'FA' | 'EN';

export interface ApiPortalItem {
    id: string;
    apiId: string;
    title: string;
    version: string;
    applicationId: string;
    method: ApiHttpMethod;
    urlTemplate: string;
    classification: ApiClassification;
    sharingStatus: ApiSharingStatus;
    breakingChange?: boolean | undefined;
    migrationNote?: string | undefined;
    ticketId?: string | undefined;
    ticketUrl?: string | undefined;
    description?: string | undefined;
    executeProductionAllowed: false;
}

export interface ApiPortalDetail extends ApiRequestDefinition {
    openapi?: Record<string, unknown> | undefined;
    executeProductionAllowed: false;
    ticketId?: string | undefined;
    ticketUrl?: string | undefined;
}

export interface ApiPortalShareTokenResult {
    id: string;
    token: string;
    expiresAt: string;
    urlPath: string;
}

export interface ApiPublicPortalDocument {
    apiId: string;
    version: string;
    name: string;
    method: ApiHttpMethod;
    urlTemplate: string;
    description?: string | undefined;
    documentation?: ApiDocumentationMetadata | undefined;
    classification?: ApiClassification | undefined;
    sharingStatus: ApiSharingStatus;
    breakingChange?: boolean | undefined;
    migrationNote?: string | undefined;
    openapi?: Record<string, unknown> | undefined;
    executeProductionAllowed: false;
    expiresAt?: string | undefined;
    readOnly: true;
    downloadPath?: string | undefined;
}

export interface ApiContractBaseline {
    id: string;
    collectionId: string;
    name: string;
    fingerprint: string;
    schemaSummary: Record<string, { required: string[]; properties: Record<string, string> }>;
    createdAt: string;
    createdBy?: string | undefined;
}

export interface ApiContractCompareResult {
    baselineId: string;
    fingerprint: string;
    currentFingerprint: string;
    breaking: Array<Record<string, unknown>>;
    nonBreaking: Array<Record<string, unknown>>;
}

export interface ApiBrandingTemplate {
    id: string;
    name: string;
    language: ApiDocLanguage;
    filePath?: string | undefined;
    createdAt: string;
    updatedAt: string;
    createdBy?: string | undefined;
}

export interface ApiBrandingState {
    activeTemplateId: string;
    templates: ApiBrandingTemplate[];
}

export interface ApiBrandingPreview {
    language: ApiDocLanguage;
    labels: Record<string, string>;
    sample: {
        title: string;
        method: string;
        endpoint: string;
    };
}

export interface ApiMockDefinition {
    id: string;
    requestId: string;
    collectionId: string;
    applicationId: string;
    environmentId?: string | undefined;
    method: ApiHttpMethod;
    pathMatch: string;
    statusCode: number;
    responseBody: string;
    responseHeaders: Array<{ name: string; value: string }>;
    status: 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'REMOVED' | string;
    expiresAt?: string | undefined;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    hitCount: number;
}

export interface ApiContractSuiteResult {
    collectionId: string;
    assertionCount: number;
    updatedRequests: number;
    openapi?: Record<string, unknown> | undefined;
}

export type ApiJitAccessStatus = 'PENDING' | 'ACTIVE' | 'REVOKED' | 'EXPIRED' | string;

export interface ApiJitAccessGrant {
    id: string;
    userId: string;
    applicationId: string;
    reason: string;
    status: ApiJitAccessStatus;
    requestedAt: string;
    expiresAt?: string | null | undefined;
    approvedBy?: string | null | undefined;
    approvedAt?: string | null | undefined;
    revokedAt?: string | undefined;
}

export interface ApiComplianceReport {
    generatedAt: string;
    dateFrom: string | null;
    dateTo: string | null;
    totals: {
        tlsInsecureExecutions: number;
        exactModeRequests: number;
        productionCommandExecutions: number;
        approvedSharesWithoutConsumers: number;
    };
    samples: {
        tlsInsecure: ApiRequestExecution[];
        exactModeRequestIds: string[];
        productionCommands: Array<{ id: string; requestId: string; startedAt: string }>;
        sharesWithoutConsumers: Array<{ id: string; apiId: string; version: string }>;
    };
}

export interface ApiOrgPolicies {
    privateDestinationAllowlist: string[];
    destinationAllowlist?: string[];
    destinationBlocklist?: string[];
    dualApprovalProductionCommand: boolean;
    forbidInsecureTlsInProduction: boolean;
    forbidExactModeInProduction: boolean;
    maxPortalShareTtlHours?: number;
    allowAnonymousPortalShare?: boolean;
    updatedAt?: string | null;
    updatedBy?: string | null;
    envPrivateDestinationAllowlist?: string[];
    envDestinationBlocklist?: string[];
    envDualApproval?: boolean;
}

export type ApiDualApprovalStatus = 'PENDING' | 'ACTIVE' | 'REVOKED' | 'EXPIRED' | string;

export interface ApiDualApprovalGrant {
    id: string;
    requestId: string;
    userId: string;
    applicationId?: string;
    reason: string;
    status: ApiDualApprovalStatus;
    requestedAt: string;
    approvedBy?: string | null;
    approvedAt?: string | null;
    expiresAt?: string | null;
}

export interface CdeOriginOption {
    id: string;
    label: string;
    baseUrl: string;
}
export interface ApiConsoleReference {
    id: string;
    apiId: string;
    version: string;
    sourceRequestId: string;
    requestId?: string | undefined;
    collectionId: string;
    applicationId: string;
    createdBy: string;
    createdAt: string;
    status: 'ACTIVE' | 'REMOVED';
    removedAt?: string | undefined;
    request?: ApiRequestDefinition | undefined;
    sourceRequest?: ApiRequestDefinition | undefined;
}
export interface ApiUsageEvent {
    id: string;
    eventType: ApiUsageEventType;
    userId: string;
    userDisplayName: string;
    activeRole: UserRole;
    applicationId: string;
    apiId: string;
    apiTitle: string;
    version: string;
    referenceId?: string | undefined;
    eventAt: string;
    environmentId?: string | undefined;
    correlationId?: string | undefined;
}
export interface ApiUsageReport extends PaginatedResponse<ApiUsageEvent> {
    summary: {
        total: number;
        uniqueApis: number;
        uniqueUsers: number;
        byType: Partial<Record<ApiUsageEventType, number>>;
    };
}
export interface ApiExecutionRunner {
    id: string;
    name: string;
    networkZone: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'TEST';
    enabled: boolean;
    allowedOriginPatterns?: string[] | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
}

export interface ApiActivityEvent {
    id: string;
    eventType: string;
    actorUserId: string;
    actorRole?: string | undefined;
    details?: Record<string, unknown> | undefined;
    createdAt: string;
}

export interface ApiTestRunResult {
    requestId: string;
    name: string;
    executionId?: string | undefined;
    status: 'PASSED' | 'FAILED' | 'SKIPPED' | string;
    transportResult?: string | undefined;
    businessResult?: string | undefined;
    assertionPassed?: number | undefined;
    assertionFailed?: number | undefined;
    error?: string | undefined;
}

export interface ApiTestRun {
    id: string;
    collectionId: string;
    applicationId: string;
    environmentId?: string | undefined;
    actorUserId: string;
    actorRole?: string | undefined;
    stopOnFail: boolean;
    results: ApiTestRunResult[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
    };
    createdAt: string;
    webhookDelivery?: { ok?: boolean; skipped?: boolean; error?: string; statusCode?: number } | null | undefined;
}
export interface ApiEffectiveRequestSnapshot {
    method: ApiHttpMethod;
    url: string;
    headers: ApiRequestHeader[];
    cookies: ApiRequestCookie[];
    body: ApiRequestBody;
    tls: ApiTlsSettings;
    omittedHeaders: Array<{
        name: string;
        reason: string;
    }>;
    variableResolution: Array<{
        key: string;
        source: ApiVariable['scope'];
        sensitive: boolean;
    }>;
}
export interface ApiRedirectRecord {
    from: string;
    to: string;
    statusCode: number;
    allowed: boolean;
    reason?: string | undefined;
}
export interface ApiAssertionEvaluation {
    assertionId: string;
    assertionType: ApiRequestAssertion['assertionType'] | 'SCRIPT_TEST';
    result: ApiBusinessResult;
    message: string;
}
export interface ApiScriptExecutionResult {
    phase: 'PRE_REQUEST' | 'POST_RESPONSE';
    line: number;
    command: string;
    result: ApiBusinessResult;
    message: string;
}
export interface ApiExecutionResponse {
    statusCode?: number | undefined;
    statusText?: string | undefined;
    headers: ApiRequestHeader[];
    cookies: ApiRequestCookie[];
    bodyPreview: string;
    bodyReference?: string | undefined;
    contentType?: string | undefined;
    responseSize: number;
    durationMs: number;
    resolvedIpAddress?: string | undefined;
    redirectHistory: ApiRedirectRecord[];
    tlsVerified: boolean;
    safePreviewMode: 'JSON' | 'TEXT' | 'SANDBOXED_HTML' | 'DOWNLOAD_ONLY';
}
export interface ApiRequestExecution {
    id: string;
    requestId: string;
    collectionId: string;
    environmentId: string;
    runnerId: string;
    executedBy: string;
    startedAt: string;
    completedAt?: string | undefined;
    durationMs?: number | undefined;
    status: ApiExecutionStatus;
    statusCode?: number | undefined;
    responseSize?: number | undefined;
    responseContentType?: string | undefined;
    requestSnapshot: ApiEffectiveRequestSnapshot;
    response?: ApiExecutionResponse | undefined;
    tlsVerification: boolean;
    transportResult: ApiTransportResult;
    businessResult: ApiBusinessResult;
    assertionResults: ApiAssertionEvaluation[];
    scriptResults?: ApiScriptExecutionResult[] | undefined;
    correlationId: string;
    errorCategory?: ApiErrorCategory | undefined;
    sanitizedError?: string | undefined;
    environmentName: string;
    evidenceType: ApiResponseEvidenceType;
    businessJustification?: string | undefined;
}
export interface ImportedCurlRecord {
    id: string;
    requestId?: string | undefined;
    originalTextReference: string;
    sanitizedPreview: string;
    detectedDialect: ApiCurlDialect;
    parserVersion: string;
    importedBy: string;
    importedAt: string;
}
export interface ApiManualResponseExample {
    id: string;
    requestId: string;
    statusCode: number;
    headers: ApiRequestHeader[];
    body: string;
    claimedEnvironmentId: string;
    source: string;
    reason: string;
    enteredBy: string;
    enteredAt: string;
    reviewedBy?: string | undefined;
    reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
    evidenceAttachmentId?: string | undefined;
}
export interface ApiDocumentationResult {
    requestId: string;
    generatedAt: string;
    generatedBy: string;
    approved: boolean;
    markdown: string;
    warnings: string[];
    wordDocumentBase64?: string | undefined;
    wordFileName?: string | undefined;
    wordMimeType?: string | undefined;
}
export interface ApiConsolePermissionPolicy {
    canView: UserRole[];
    canCreate: UserRole[];
    canEdit: UserRole[];
    canExecute: UserRole[];
    canExecuteProduction: UserRole[];
    canExecuteCommand: UserRole[];
    canExecuteProductionCommand: UserRole[];
    canDelete: UserRole[];
    canGenerateDocumentation: UserRole[];
  canReviewShares: UserRole[];
  canViewUsageReports: UserRole[];
  canManageUsers: UserRole[];
  canManageProtectedEnvironments: UserRole[];
}
