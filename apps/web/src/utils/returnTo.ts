const RETURN_TO_KEY = 'api-console-return-to';

export function rememberReturnTo(path: string): void {
  if (path && path.startsWith('/')) {
    sessionStorage.setItem(RETURN_TO_KEY, path);
  }
}

export function consumeReturnTo(): string {
  const target = sessionStorage.getItem(RETURN_TO_KEY) || '/';
  sessionStorage.removeItem(RETURN_TO_KEY);
  return target;
}
