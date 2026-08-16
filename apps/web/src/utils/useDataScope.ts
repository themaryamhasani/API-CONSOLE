import { useAuthStore } from '../stores/authStore';
import type { ApplicationScopeFilter, AccessScope } from '../types';

export function useDataScope(): {
  appId: ApplicationScopeFilter;
  defaultApplicationId: string;
  initialApplicationIdForCreate: string;
  requiresExplicitApplicationSelection: boolean;
  scopeApplicationIds: string[];
  scope: AccessScope;
  isAppLevel: boolean;
  isMultiSystem: boolean;
  scopeLabel: string;
} {
  const { activeContext } = useAuthStore();

  if (!activeContext) {
    return {
      appId: undefined,
      defaultApplicationId: '',
      initialApplicationIdForCreate: '',
      requiresExplicitApplicationSelection: false,
      scopeApplicationIds: [],
      scope: 'SYSTEMS',
      isAppLevel: false,
      isMultiSystem: false,
      scopeLabel: '',
    };
  }

  const isApp = activeContext.scope === 'APP';
  const ids = activeContext.scopeApplicationIds || [];
  const appId = isApp ? undefined : ids.length === 1 ? ids[0] : ids;
  const requiresExplicitApplicationSelection = isApp || ids.length > 1;
  const initialApplicationIdForCreate = requiresExplicitApplicationSelection
    ? ''
    : ids[0] || (activeContext.applicationId !== 'ALL' ? activeContext.applicationId : '');
  const scopeLabel = Array.from(new Set(
    (activeContext.applications?.length ? activeContext.applications : [activeContext.application])
      .map(application => application.name)
      .filter(Boolean)
  )).join('، ');

  return {
    appId,
    defaultApplicationId: ids[0] || activeContext.applicationId,
    initialApplicationIdForCreate,
    requiresExplicitApplicationSelection,
    scopeApplicationIds: ids,
    scope: activeContext.scope,
    isAppLevel: isApp,
    isMultiSystem: !isApp && ids.length > 1,
    scopeLabel: scopeLabel || 'پروژه‌ای تعیین نشده',
  };
}
