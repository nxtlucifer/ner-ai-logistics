# Premium Navigation & Route Risk Engine V2 — Research & Architecture Document

**Date Accessed / Compiled:** 2026-09-08  
**Project:** NER-AI-Logistics (znaveeefzgfxsblsobdb, North East India Logistics Corridor)  
**Authors:** Principal Product Engineer, Routing & GIS Specialist, Transportation Safety Engineer  

---

## 1. Executive Research Summary & Technology Comparison Matrix

| Technology / Domain | Source | Capability | Limitation | Cost / Billing | Project Implication |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Navigation SDK** | Google Maps Platform Docs (2026) | Turn-by-turn turn guidance, real-time rerouting, proprietary traffic models, Google voice | Closed source, requires native Android/iOS SDK integration, incompatible with standard Expo Go without custom prebuild/config plugins, high enterprise pricing (\–\/1000 requests) | Heavy per-trip billing; enterprise contract gate | **DECISION: REJECT FOR HACKATHON**. Risk of billing shutoff, credential exposure in mobile binary, and native build failures. Recreate Google-like UX over open stack. |
| **MapLibre GL / React Native MapLibre** | MapLibre Official Specification v3.x | Hardware-accelerated vector & raster maps, smooth camera tracking, heading rotation, custom pucks, GeoJSON layers, 100% offline tile support | No built-in routing engine (only map renderer) | Free / Open Source (BSD-3) | **DECISION: PRIMARY MAP ENGINE**. Rock-solid reliability, zero billing, complete control over styling, custom truck markers, and hazard heatmaps. |
| **OSRM (Open Source Routing Machine)** | Project OSRM API v5.24 | Extremely fast contraction hierarchies routing, turn-by-turn maneuvers, alternative route calculation (alternatives=true), GeoJSON polylines | Profile-bound (standard car/truck), lacks dynamic road closure avoidance without custom graph rebuilds | Free / Open Source (MIT) | **DECISION: CORE PRIMARY & FALLBACK ROUTER**. Live demo server and self-hosted instances return fast multi-route geometries and maneuvers for North East India (NH-27, NH-715, NH-6, NH-37). |
| **Valhalla Routing Engine** | Valhalla Mobility Core Docs | Dynamic costing for heavy goods vehicles (HGV: height, width, length, axle weight, hazmat), elevation profiling, multi-point corridor alternatives | Requires running Valhalla Docker service or external Valhalla provider | Open Source / Free self-hosted | **DECISION: ARCHITECTED AS SECONDARY TRUCK PROVIDER**. Abstracted behind NavigationProvider so truck profile constraints can be enriched deterministically. |
| **Open-Meteo Weather API** | Open-Meteo Weather API Docs | High-resolution hourly forecasts: precipitation (mm), rain probability (%), wind speed & gusts (km/h), visibility (m), soil moisture, WMO weather codes | 10,000 daily free API calls; corridor queries must be batched or downsampled | Free tier (Non-commercial & Hackathon fair use) | **DECISION: PRIMARY WEATHER RISK ENGINE**. Sample 5–15 km intervals along route geometry to compute segment-level weather risk. |
| **NASA COOLR & LHASA** | NASA Earthdata & Disasters Program | Global Landslide Catalog (COOLR) for historical event density; Landslide Hazard Assessment for Situational Awareness (LHASA v2) for rainfall-triggered hazard | Not an instantaneous sensor: LHASA provides hazard probability, not a live camera of a blockage | Free Open Data / Earthdata API | **DECISION: TWO-TIER LANDSLIDE ENGINE**. Layer 1: Historical corridor susceptibility; Layer 2: Near-real-time rainfall-triggered landslide hazard. |
| **Heavy Vehicle Fuel Physics Model** | SAE International & Comprehensive Modal Emission Model (CMEM) | Deterministic fuel estimation based on vehicle tare, gross vehicle weight (GVW), gradient/incline work, aerodynamic drag, rolling resistance, and idling | Dependent on known truck parameters; requires conservative fallback for uncalibrated trucks | Zero external API cost (Local pure physics) | **DECISION: CORE DETERMINISTIC FUEL ENGINE**. Equation: F = (B_tare + C_load * M_cargo + C_grade * deltaH + C_speed * v) * D. LLM never guesses fuel. |
| **Google Gemini 2.5 Flash / 3-Flash** | Google AI Studio Developer API | Natural language explanation, multi-language vernacular translation, driver safety chat assistance | Non-deterministic, must never calculate risk scores, route geometry, or fuel | Paid / Free Tier API Key | **DECISION: EXPLANATORY & ASSISTANCE ONLY**. Translates structured risk assessments and assists drivers without entering safety-critical decision paths. |
| **OpenRouter / DeepSeek / Nemotron** | OpenRouter API v1 | Deep reasoning tokens, fallback assistant intelligence, cross-validation of complex operational summaries | Rate limits on free endpoints; variable latency | Free / Credit-based API | **DECISION: SECONDARY PREDICTION & REASONING AGENT**. Synthesizes route comparison trade-offs when managers click Why this route?. |

---

## 2. Google Navigation SDK Decision Gate Analysis

1. **Implementation Time:** Google Nav SDK requires native Kotlin bridge or EAS config plugins, taking 15+ hours to configure and test. MapLibre + OSRM is already verified and operating in both driver-app and manager-web.
2. **Billing & Account Risk:** Google Navigation SDK is an enterprise-only API requiring credit cards and Maps Platform billing approval. A billing freeze or quota trip would kill the hackathon demo mid-presentation.
3. **Truck-Specific Constraints:** Google Maps consumer routing does not allow passing axle weights, hazardous materials flags, or heavy vehicle clearance constraints into basic consumer routes.
4. **Offline Potential:** Google Maps mobile SDK caches tiles opaquely. MapLibre allows deterministic offline MBTiles / vector tile caching.
5. **Verdict:** KEEP CURRENT STACK (MapLibre + OSRM). Implement the high-quality Google Maps interaction model (recenter, heading follow, top maneuver card, distance countdown, speed indicator, voice alerts, route overview) natively in React Native.
