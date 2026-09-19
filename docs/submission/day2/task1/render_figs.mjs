// Render the report's two diagrams (architecture, core ER) from Mermaid to PNG
// with headless Chrome + mermaid 11, into figures/. Same mechanics as render_er.mjs.
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { launch, sleep } from '../../../../.runtime/rehearsal/cdp.mjs'

const OUT = 'D:/Projects/ner-ai-logistics/docs/submission/day2/task1/figures'
mkdirSync(OUT, { recursive: true })

const FIGS = {
  arch: `flowchart TB
    subgraph clients["Clients"]
      direction LR
      M["<b>Manager Web</b><br/>React + TypeScript + Vite<br/><i>manager-web/src/api/client.ts</i>"]
      D["<b>Driver App</b><br/>React Native + Expo (Android APK, web)<br/><i>driver-app/src/api/client.ts</i>"]
    end
    M -- "REST + JSON · Bearer JWT<br/>(refresh cookie)" --> API
    D -- "REST + JSON · Bearer JWT<br/>(refresh token in secure store)" --> API
    subgraph API["<b>FastAPI backend</b> — backend/app  (86 routes, 14 routers)"]
      direction TB
      R1["Auth and RBAC · Drivers · Trucks · Assignments"]
      R2["Shipments · Trips · Routes and review · Fleet location"]
      R3["Driver self-service · GPS telemetry · Emergencies · Files · Geocoding"]
      S["Services and domain rules — state machine, capacity and reservation gates,<br/>deterministic route risk, audit on every mutation"]
      R1 --> S
      R2 --> S
      R3 --> S
    end
    S -- "SQLAlchemy 2 async + psycopg 3<br/>Alembic 0001 → 0012" --> DB
    DB[("<b>PostgreSQL + PostGIS</b><br/>Supabase (hosted) · isolated cluster (local)<br/>20 tables · RLS · geography(4326)")]
    EXT["External providers (read-only, health-tracked):<br/>OSRM routing · Open-Meteo weather · warnings feed · Nominatim"]
    S -. "httpx, cached, UNKNOWN ≠ SAFE" .-> EXT
    classDef client fill:#EAF3F5,stroke:#123B4F,color:#101820,stroke-width:1.2px
    classDef api fill:#F5F8F9,stroke:#0F5F6B,color:#101820,stroke-width:1.2px
    classDef db fill:#123B4F,stroke:#123B4F,color:#FFFFFF
    classDef ext fill:#FFFFFF,stroke:#9AA9B1,color:#3C4A52,stroke-dasharray:4
    class M,D client
    class R1,R2,R3,S api
    class DB db
    class EXT ext
    style clients fill:transparent,stroke:transparent
    style API fill:#FBFDFD,stroke:#0F5F6B,stroke-width:1.4px,color:#0F5F6B`,

  ercore: `erDiagram
    direction LR
    users ||--o| drivers : "login of"
    drivers ||--o{ driver_truck_assignments : "one open pairing"
    trucks  ||--o{ driver_truck_assignments : "one open pairing"
    shipments ||--|{ cargo_items : "contains"
    shipments ||--o{ trips : "fulfilled by"
    drivers ||--o{ trips : "drives"
    trucks  ||--o{ trips : "carries"
    trips ||--|{ trip_stops : "ordered stops"
    trips ||--o{ trip_routes : "candidate roads"
    trips ||--o{ trip_events : "journey history"
    trips ||--o{ gps_points : "telemetry"
    trip_routes ||--o{ route_review_authorizations : "review"
    users {
        uuid id PK
        user_role role
        varchar email
    }
    drivers {
        uuid id PK
        uuid user_id FK
        varchar licence_number
        driver_status status
    }
    trucks {
        uuid id PK
        varchar registration_number
        numeric max_capacity_kg
        truck_status status
    }
    driver_truck_assignments {
        uuid id PK
        uuid driver_id FK
        uuid truck_id FK
        assignment_status status
    }
    shipments {
        uuid id PK
        varchar reference_code
        geography pickup_location
        numeric total_weight_kg
    }
    cargo_items {
        uuid id PK
        uuid shipment_id FK
        numeric weight_kg
    }
    trips {
        uuid id PK
        varchar trip_code
        trip_status status
        uuid selected_route_id FK
    }
    trip_stops {
        uuid id PK
        smallint sequence
        geography location
    }
    trip_routes {
        uuid id PK
        route_kind kind
        geography geometry
    }
    trip_events {
        bigint id PK
        trip_event_kind kind
    }
    gps_points {
        bigint id PK
        geography location
        timestamptz recorded_at
    }
    route_review_authorizations {
        uuid id PK
        text rationale
    }`,
}

const P = await launch({ width: 2000, height: 1600, mobile: false, port: 9399 })
try {
  for (const [name, src] of Object.entries(FIGS)) {
    const isEr = src.trim().startsWith('erDiagram')
    const html = `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>body{margin:0;background:#fff;font-family:Segoe UI,Arial,sans-serif} #d{display:inline-block;padding:16px}</style>
</head><body><div id="d"><pre class="mermaid">${src.replace(/&(?!amp;|lt;|gt;)/g, '&amp;').replace(/</g, '&lt;')}</pre></div>
<script>mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose', themeVariables: { fontSize: '${isEr ? 24 : 17}px', fontFamily: 'Segoe UI, Arial, sans-serif', primaryColor: '#EAF3F5', primaryBorderColor: '#123B4F', lineColor: '#123B4F', tertiaryColor: '#F5F8F9' }, flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis', nodeSpacing: 34, rankSpacing: 46, padding: 12 }, er: { useMaxWidth: false, layoutDirection: 'LR', minEntityWidth: 180, minEntityHeight: 56, entityPadding: 16 } });</script>
</body></html>`
    const file = `${OUT}/${name}.html`
    writeFileSync(file, html)
    await P.goto('file:///' + file)
    let ok = null
    for (let t = 0; t < 60 && !ok; t += 1) {
      await sleep(500)
      ok = await P.eval(`const s = document.querySelector('svg'); if (!s) return null; const r = s.getBoundingClientRect(); return r.width > 50 && r.height > 50`)
    }
    if (!ok) { const t = await P.eval('return document.body.innerText.slice(0, 600)'); throw new Error(name + ' did not render: ' + t) }
    await P.eval(`const s = document.querySelector('svg'); const b = s.getBBox(); const w = Math.ceil(b.x + b.width + 20), h = Math.ceil(b.y + b.height + 20); s.setAttribute('viewBox', '0 0 ' + w + ' ' + h); s.setAttribute('width', w); s.setAttribute('height', h); s.style.maxWidth = 'none'; return [w, h]`)
    await sleep(300)
    const r = await P.eval(`const r = document.querySelector('svg').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }`)
    await P.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(r.x + r.w + 40), height: Math.ceil(r.y + r.h + 40), deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    const shot = await P.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 2 }, captureBeyondViewport: true })
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, 'base64'))
    unlinkSync(file)
    console.log(name, Math.round(r.w), 'x', Math.round(r.h))
  }
} finally { await P.close() }
