import { create } from 'zustand';
import type { ActiveContext } from '../types';
import {
  cdeApi,
  sessionApi,
  setCsrfToken,
  type CdeCatalog,
  type CdeConnectionStatus,
  type CdeProjectDescriptor,
} from '../services/cdeApi';
import { isApi, type IsSystemDescriptor } from '../services/isApi';
import { PERSONAL_APPLICATION_ID, PERSONAL_APPLICATION_LABEL } from '../types/apiConsole';

export type AuthApproach = 'CDE' | 'IS' | 'LOCAL' | null;

function isSystemsToProjects(systems: IsSystemDescriptor[]): CdeProjectDescriptor[] {
  return systems.map(system => ({
    projectKey: system.applicationId,
    repositories: {
      WEB_UI: '',
      DATA_SERVICE: '',
      API_MODULE: system.label || system.serviceKey,
      MESSAGE_CONSUMER: '',
    },
    editorUrls: {
      webUi: '',
      dataService: '',
      gateway: `${system.gatewayBaseUrl}${system.basePath}`,
    },
  }));
}

function personalProject(): CdeProjectDescriptor {
  return {
    projectKey: PERSONAL_APPLICATION_ID,
    repositories: {
      WEB_UI: '',
      DATA_SERVICE: '',
      API_MODULE: PERSONAL_APPLICATION_LABEL,
      MESSAGE_CONSUMER: '',
    },
    editorUrls: { webUi: '', dataService: '', gateway: '' },
  };
}

type SessionState = {
  bootstrapped: boolean;
  loading: boolean;
  authenticated: boolean;
  authApproach: AuthApproach;
  cdeConnected: boolean;
  isConnected: boolean;
  cdeStatus: CdeConnectionStatus | null;
  activeContext: ActiveContext | null;
  projects: CdeProjectDescriptor[];
  isSystems: IsSystemDescriptor[];
  selectedProjectKey: string;
  catalog: CdeCatalog | null;
  error: string | null;
  bootstrap: () => Promise<void>;
  setActiveContext: (context: ActiveContext | null) => void;
  refreshProjects: () => Promise<CdeProjectDescriptor[]>;
  selectProject: (projectKey: string) => Promise<void>;
  loadCatalog: (projectKey?: string) => Promise<CdeCatalog | null>;
  applyIsLogin: (systems?: IsSystemDescriptor[]) => Promise<void>;
  disconnect: () => Promise<void>;
  logout: () => Promise<void>;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  bootstrapped: false,
  loading: false,
  authenticated: false,
  authApproach: null,
  cdeConnected: false,
  isConnected: false,
  cdeStatus: null,
  activeContext: null,
  projects: [],
  isSystems: [],
  selectedProjectKey: '',
  catalog: null,
  error: null,

  setActiveContext: (context) => set({ activeContext: context }),

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const session = await sessionApi.current();
      if (session.csrfToken) setCsrfToken(session.csrfToken);
      const authApproach = (session.authApproach || (session.cdeConnected ? 'CDE' : session.isConnected ? 'IS' : null)) as AuthApproach;

      if (authApproach === 'IS' || session.isConnected) {
        let systems: IsSystemDescriptor[] = [];
        try {
          systems = (await isApi.systems()).systems || [];
        } catch {
          systems = [];
        }
        const projects = [personalProject(), ...isSystemsToProjects(systems)];
        let selectedProjectKey = session.applicationId || PERSONAL_APPLICATION_ID;
        let activeContext = session.activeContext;
        if (!activeContext && selectedProjectKey) {
          const selected = await sessionApi.selectContext(
            selectedProjectKey,
            projects.map(project => project.projectKey),
          );
          activeContext = selected.activeContext;
          if (selected.csrfToken) setCsrfToken(selected.csrfToken);
        }
        set({
          bootstrapped: true,
          loading: false,
          authenticated: Boolean(session.authenticated || activeContext),
          authApproach: 'IS',
          cdeConnected: false,
          isConnected: true,
          cdeStatus: null,
          projects,
          isSystems: systems,
          selectedProjectKey,
          activeContext,
          catalog: null,
        });
        return;
      }

      let cdeStatus: CdeConnectionStatus | null = null;
      if (session.cdeConnected) {
        cdeStatus = await cdeApi.status();
      }
      let projects: CdeProjectDescriptor[] = [];
      let selectedProjectKey = session.applicationId || '';
      let activeContext = session.activeContext;
      if (cdeStatus?.connected) {
        projects = await cdeApi.projects();
        if (!selectedProjectKey && projects[0]) selectedProjectKey = projects[0].projectKey;
        if (selectedProjectKey) {
          const selected = await sessionApi.selectContext(
            selectedProjectKey,
            projects.map(project => project.projectKey),
          );
          activeContext = selected.activeContext;
          if (selected.csrfToken) setCsrfToken(selected.csrfToken);
        }
      }
      set({
        bootstrapped: true,
        loading: false,
        authenticated: Boolean((cdeStatus?.connected || session.authenticated) && activeContext),
        authApproach: cdeStatus?.connected ? 'CDE' : null,
        cdeConnected: Boolean(cdeStatus?.connected),
        isConnected: false,
        cdeStatus,
        projects,
        isSystems: [],
        selectedProjectKey,
        activeContext,
      });
    } catch (error) {
      set({
        bootstrapped: true,
        loading: false,
        authenticated: false,
        authApproach: null,
        cdeConnected: false,
        isConnected: false,
        cdeStatus: { connected: false },
        activeContext: null,
        error: error instanceof Error ? error.message : 'Bootstrap failed',
      });
    }
  },

  applyIsLogin: async (systemsInput) => {
    const systems = systemsInput || (await isApi.systems()).systems || [];
    const projects = [personalProject(), ...isSystemsToProjects(systems)];
    const selected = await sessionApi.selectContext(
      PERSONAL_APPLICATION_ID,
      projects.map(project => project.projectKey),
    );
    if (selected.csrfToken) setCsrfToken(selected.csrfToken);
    set({
      authenticated: Boolean(selected.activeContext),
      authApproach: 'IS',
      cdeConnected: false,
      isConnected: true,
      cdeStatus: null,
      projects,
      isSystems: systems,
      selectedProjectKey: PERSONAL_APPLICATION_ID,
      activeContext: selected.activeContext,
      catalog: null,
    });
  },

  refreshProjects: async () => {
    if (get().authApproach === 'IS') {
      const systems = (await isApi.systems()).systems || [];
      const projects = [personalProject(), ...isSystemsToProjects(systems)];
      set({ projects, isSystems: systems, isConnected: true, authenticated: true, authApproach: 'IS' });
      return projects;
    }
    const projects = await cdeApi.projects();
    set({ projects, cdeConnected: true, authenticated: true, authApproach: 'CDE' });
    return projects;
  },

  selectProject: async (projectKey: string) => {
    const projects = get().projects;
    const selected = await sessionApi.selectContext(
      projectKey,
      projects.map(project => project.projectKey),
    );
    if (selected.csrfToken) setCsrfToken(selected.csrfToken);
    set({
      selectedProjectKey: projectKey,
      activeContext: selected.activeContext,
      authenticated: Boolean(selected.activeContext),
    });
    if (get().authApproach === 'CDE' && !projectKey.startsWith('is:') && projectKey !== PERSONAL_APPLICATION_ID) {
      await get().loadCatalog(projectKey);
    } else {
      set({ catalog: null });
    }
  },

  loadCatalog: async (projectKey) => {
    if (get().authApproach !== 'CDE') {
      set({ catalog: null });
      return null;
    }
    const key = projectKey || get().selectedProjectKey;
    if (!key || key === PERSONAL_APPLICATION_ID || key.startsWith('is:')) {
      set({ catalog: null });
      return null;
    }
    const catalog = await cdeApi.projectCatalog(key);
    set({ catalog });
    return catalog;
  },

  disconnect: async () => {
    const approach = get().authApproach;
    if (approach === 'IS') {
      try {
        await isApi.disconnect();
      } catch {
        await sessionApi.logout();
      }
    } else {
      try {
        await cdeApi.disconnect();
      } catch {
        await sessionApi.logout();
      }
    }
    set({
      authenticated: false,
      authApproach: null,
      cdeConnected: false,
      isConnected: false,
      cdeStatus: { connected: false },
      activeContext: null,
      projects: [],
      isSystems: [],
      selectedProjectKey: '',
      catalog: null,
    });
  },

  logout: async () => {
    await sessionApi.logout();
    set({
      authenticated: false,
      authApproach: null,
      cdeConnected: false,
      isConnected: false,
      cdeStatus: { connected: false },
      activeContext: null,
      projects: [],
      isSystems: [],
      selectedProjectKey: '',
      catalog: null,
    });
  },
}));

/** Compatibility shim so OnlineApiConsolePage can keep using useAuthStore. */
export const useAuthStore = useSessionStore;
