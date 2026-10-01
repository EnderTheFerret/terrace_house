# Progress

| Milestone | Status | Notes |
|---|---|---|
| M1 Foundation | ✅ | npm workspaces, strict TS, ESLint/Prettier, zod model, mulberry32, mock adapters, `/api/health`, `dev:mock` title screen |
| M2 Engine & content | ✅ | relationships, director scoring, 87 event templates (30 arc-only, 11 domestic, 7 calendar, 11 system), slot/episode loop, leave rules, memory compaction; 200-seed sim passes |
| M2b Living world | ✅ | personas, default cast + generator, agent tick, beliefs/knowledge/gossip, arcs, house, social, outside cast, calendar, replacements, render filter; §5.5P tests pass |
| M3 Creator/House/Scenes/Phone | ⏳ | server scene pipeline (two-stage, SSE) done; UI in progress |
| M4 City | ⏳ | engine reachability done |
| M5 Cooking | ⏳ | engine done |
| M6 Studio | ⏳ | engine + mock commentary done |
| M7 Real backends | ⏳ | adapters written, smoke pending |
| M8 Polish & docs | ⏳ | |

## Log
- **M1–M2b** — shared engine and content complete. Tests: 41 (rng, content, calendar, clamping, compaction, director,
  leave rules, cast generator, purity, mock schema validity, voice distinctness + catchphrase caps, appearance prompt
  safety, 200-seed idle season sweep with range/knowledge/gossip-chain invariants, NPC romance emergence fraction,
  idle-season meaningful events, determinism). Server API + mock pipeline smoke-tested with curl; title screen served.
  - Bug found by the sweep and fixed: the season could end early when three housemates were marked to leave on the
    same night (before replacements); now replacements are counted and leavers depart with the finale.

## Known gaps
- (tracked per milestone above)
