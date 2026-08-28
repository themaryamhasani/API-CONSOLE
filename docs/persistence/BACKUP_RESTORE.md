# Backup & Restore — API Console persistence

Short runbook for file-backed and SQLite store modes (E01 / S01.05).

## What to back up

| Asset | Default path | Notes |
| --- | --- | --- |
| JSON store (FILE mode) | `runtime/api-console/api-console-store.json` | Primary data when `API_CONSOLE_STORE_BACKEND=FILE` |
| SQLite DB (SQLITE mode) | `runtime/api-console/api-console.sqlite` | Includes `store_blob` + reporting entity tables |
| Secret vault | `runtime/api-console/api-console-secrets.json` | Encrypted secrets; back up with the store |
| Vault key | `runtime/api-console/api-console-secret.key` | Required to decrypt vault |
| Optional WAL sidecars | `api-console.sqlite-wal`, `api-console.sqlite-shm` | Include if present while DB is hot |

Override paths with `API_CONSOLE_DATA_DIR`, `API_CONSOLE_STORE_FILE`, `API_CONSOLE_SQLITE_FILE`, `API_CONSOLE_SECRET_VAULT_FILE`, `API_CONSOLE_SECRET_KEY_FILE`.

## Backup (cold)

1. Stop the API process (or ensure no writers).
2. Copy the data directory:

```bash
# PowerShell
Copy-Item -Recurse runtime/api-console backup/api-console-$(Get-Date -Format yyyyMMdd-HHmmss)
```

3. Verify the copy contains store + vault + key (and `.sqlite` if using SQLITE mode).

## Backup (hot SQLite)

Prefer a consistent snapshot:

```bash
# Node 22+ — uses node:sqlite backup API when available
node -e "const {DatabaseSync,backup}=require('node:sqlite'); const src=new DatabaseSync('runtime/api-console/api-console.sqlite'); backup(src,'runtime/api-console/api-console.backup.sqlite').then(()=>src.close());"
```

If `backup` is unavailable, stop the process and copy the `.sqlite` file (plus `-wal`/`-shm` if present).

## Restore — FILE mode

1. Stop the API.
2. Restore `api-console-store.json`, vault, and key into `API_CONSOLE_DATA_DIR`.
3. Ensure `API_CONSOLE_STORE_BACKEND=FILE` (or unset).
4. Start the API and smoke-test login + a collection list.

## Restore — SQLITE mode

1. Stop the API.
2. Restore `api-console.sqlite` (and vault/key).
3. Set:

```bash
API_CONSOLE_STORE_BACKEND=SQLITE
API_CONSOLE_SQLITE_FILE=runtime/api-console/api-console.sqlite
```

4. Start the API. The adapter loads `store_blob` (`id='main'`) into the same in-memory shape as FILE mode.

## Migrate JSON → SQLite

```bash
npm run migrate:db -w @api-console/api -- --dry-run
npm run migrate:db -w @api-console/api
```

Migration is idempotent (replaces blob + rebuilds entity tables). Keep the JSON file as a fallback until SQLITE mode is validated.

## Staging restore check

1. Point a staging instance at a restored copy of the data dir (do not share production vault keys in shared hosts).
2. Run `npm run test:persist -w @api-console/api`.
3. Confirm collection/request counts match the backup report from `--dry-run` / migrate output.
4. Confirm secrets still resolve (environment secret references) after vault restore.

## Rollback

- SQLITE → FILE: keep the last good `api-console-store.json`, set `API_CONSOLE_STORE_BACKEND=FILE`, restart.
- FILE → SQLITE: re-run migrate, then switch backend to `SQLITE`.
