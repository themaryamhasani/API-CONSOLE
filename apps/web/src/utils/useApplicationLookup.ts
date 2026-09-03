import { useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import { PERSONAL_APPLICATION_ID, PERSONAL_APPLICATION_LABEL } from '../types/apiConsole';
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
        name: project.projectKey === PERSONAL_APPLICATION_ID
          ? PERSONAL_APPLICATION_LABEL
          : (project.repositories?.API_MODULE || project.projectKey),
        code: project.repositories?.API_MODULE || project.projectKey,
        description: project.projectKey.startsWith('is:') ? 'Integrated Systems' : '',
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
    if (applicationId === PERSONAL_APPLICATION_ID) return PERSONAL_APPLICATION_LABEL;
    if (applicationId.startsWith('is:')) {
      const serviceKey = applicationId.slice(3);
      return applicationNameById[applicationId] || serviceKey || applicationId;
    }
    return applicationNameById[applicationId] || activeContext?.application?.name || applicationId;
  };

  return { applications, loading: false, shouldShowSystemColumn, getApplicationName };
}
