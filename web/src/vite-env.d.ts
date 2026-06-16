/// <reference types="vite/client" />

// Optional build-time metadata, injected by CI (e.g. via `define` or a `.env`):
// version/date/commit of the build. All optional — the About panel falls back to
// the package version / "Not available" when unset. No sensitive values here.
interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string
  readonly VITE_BUILD_DATE?: string
  readonly VITE_COMMIT_SHA?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
