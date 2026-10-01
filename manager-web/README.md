# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Planning on the hosted Supabase target (P1R-15, RG-7)

Where a trip may go is decided on the server: both ends inside India, one end in the North-East, and a domestic route that never crosses an international boundary. The browser draws no region box of its own and never routes.

- `VITE_BACKEND=local` (FastAPI): `/api/trips/plan` and `/api/trips/{id}/routes/recalculate` check geography and route on the server.
- `VITE_BACKEND=supabase`: `public.plan_trip` checks auth and existence only, not geography, so the console never calls it. Trip and route planning go to the intelligence plane (`VITE_INTELLIGENCE_BASE_URL`, the same FastAPI endpoints). With no plane configured, *Create draft trip* and *Plan route* are disabled with the reason. With the plane unreachable, planning fails with `503 PLANNING_UNAVAILABLE` / `ROUTING_UNAVAILABLE` and the browser writes nothing. The browser no longer calls the public OSRM demo server and no longer stores a fallback corridor.
- Still open, outside this app: `public.plan_trip` stays callable directly by an authenticated manager and has no geography check. A Supabase migration must add the check or revoke `EXECUTE`. `public.select_route` has no provider guard, so it can still select `cached_corridor` rows written before this change.
