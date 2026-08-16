import { create } from 'zustand';
import type { ActiveContext } from '../types';
import { cdeApi, sessionApi, setCsrfToken, type CdeCatalog, type CdeConnectionStatus, type CdeProjectDescriptor } from '../services/cdeApi';

type SessionState = {
  bootstrapped: boolean;
  loading: boolean;
  cdeConnected: boolean;
  cdeStatus: CdeConnectionStatus | null;
  activeContext: ActiveContext | null;
  projects: CdeProjectDescriptor[];
  selectedProjectKey: string;
  catalog: CdeCatalog | null;
  error: string | null;
  bootstrap: () => Promise<void>;
  setActiveContext: (context: ActiveContext | null) => void;
  refreshProjects: () => Promise<CdeProjectDescriptor[]>;
  selectProject: (projectKey: string) => Promise<void>;
  loadCatalog: (projectKey?: string) => Promise<CdeCatalog | null>;
  disconnect: () => Promise<void>;
  logout: () => Promise<void>;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  bootstrapped: false,
  loading: false,
  cdeConnected: false,
  cdeStatus: null,
  activeContext: null,
  projects: [],
  selectedProjectKey: '',
  catalog: null,
  error: null,

  setActiveContext: (context) => set({ activeContext: context }),

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const session = await sessionApi.current();
      if (session.csrfToken) setCsrfToken(session.csrfToken);
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
        cdeConnected: Boolean(cdeStatus?.connected),
        cdeStatus,
        projects,
        selectedProjectKey,
        activeContext,
      });
    } catch (error) {
      set({
        bootstrapped: true,
        loading: false,
        cdeConnected: false,
        cdeStatus: { connected: false },
        activeContext: null,
        error: error instanceof Error ? error.message : 'Bootstrap failed',
      });
    }
  },

  refreshProjects: async () => {
    const projects = await cdeApi.projects();
    set({ projects, cdeConnected: true });
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
    });
    await get().loadCatalog(projectKey);
  },

  loadCatalog: async (projectKey) => {
    const key = projectKey || get().selectedProjectKey;
    if (!key) {
      set({ catalog: null });
      return null;
    }
    const catalog = await cdeApi.projectCatalog(key);
    set({ catalog });
    return catalog;
  },

  disconnect: async () => {
    await cdeApi.disconnect();
    set({
      cdeConnected: false,
      cdeStatus: { connected: false },
      activeContext: null,
      projects: [],
      selectedProjectKey: '',
      catalog: null,
    });
  },

  logout: async () => {
    await sessionApi.logout();
    set({
      cdeConnected: false,
      cdeStatus: { connected: false },
      activeContext: null,
      projects: [],
      selectedProjectKey: '',
      catalog: null,
    });
  },
}));

/** Compatibility shim so OnlineApiConsolePage can keep using useAuthStore. */
export const useAuthStore = useSessionStore;
