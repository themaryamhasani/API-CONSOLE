import { useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useDataScope } from './useDataScope';

export function useApplicationLookup() {
  const { activeContext, projects } = useAuthStore();
  const { scopeApplicationIds, isAppLevel, isMultiSystem } = useDataScope();

  const isSystemAdmin = activeContext?.role === 'SYSTEM_ADMIN';
  const shouldShowSystemColumn =
    !!activeContext && (isAppLevel || isMultiSystem || scopeApplicationIds.length > 1 || projects.length > 1);

  const lookupRows = useMemo(() => {
    if (projects.length) {
      return projects.map(project => ({
        id: project.projectKey,
        name: project.projectKey,
        code: project.repositories.API_MODULE,
        description: '',
        isActive: true,
      }));
    }
    if (!activeContext) return [];
    const rows = activeContext.applications?.length
      ? activeContext.applications
      : activeContext.application
        ? [activeContext.application]
        : [];
    return rows.filter(application => application.isActive);
  }, [activeContext, projects]);

  const applications = useMemo(() => {
    const allowed = isSystemAdmin || isAppLevel
      ? lookupRows
      : lookupRows.filter(app => scopeApplicationIds.includes(app.id) || !scopeApplicationIds.length);
    return allowed.filter(app => app.isActive);
  }, [lookupRows, isSystemAdmin, isAppLevel, scopeApplicationIds.join('|')]);

  const applicationNameById = useMemo(
    () => lookupRows.reduce<Record<string, string>>((acc, app) => {
      acc[app.id] = app.name;
      return acc;
    }, {}),
    [lookupRows]
  );

  const getApplicationName = (applicationId?: string) => {
    if (!applicationId) return '-';
    if (applicationId === 'ALL') return 'همه پروژه‌ها';
    return applicationNameById[applicationId] || activeContext?.application?.name || applicationId;
  };

  return { applications, loading: false, shouldShowSystemColumn, getApplicationName };
}
