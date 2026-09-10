# Stop Adedanha Constitution

<!--
Sync Impact Report
- Version change: 1.1.0 -> 1.2.0
- Modified principles: architecture updated from Java/Gradle to Cloudflare Workers/TypeScript
- Added sections: none
- Removed sections: none
- Follow-up TODOs: none
-->

## Core Principles

### I. Clean Code and Clear Boundaries

Frontend and backend code MUST use meaningful names, small cohesive functions, explicit types,
and single-purpose modules. React components MUST focus on presentation and interaction, while
game rules MUST live in testable domain modules. Worker transport code MUST remain separate from
Durable Object state management and scoring.

### II. Testable Behavior First

Every new user-visible behavior MUST have acceptance coverage. Scoring, validation, state
transitions, timeout handling, duplicate requests, invalidation thresholds, and tie handling MUST
have automated tests. Changes to WebSocket messages or shared data shapes MUST have contract tests.
Changes involving multiple players MUST include an integration or end-to-end scenario with at least
two independent clients.

### III. Server-Authoritative Multiplayer

The Durable Object room service MUST be the authority for player identity within the room, capacity,
host permissions, game phase, deadlines, Stop, responses, invalidation votes, scoring, and ranking.
Clients MUST NOT calculate final scores, advance phases, or decide deadlines. Every state-changing
command MUST be validated against the current phase and MUST be idempotent or safely rejected by a
request identifier.

### IV. Secure and Minimal Data Handling

The frontend MUST contain no Cloudflare API tokens or server secrets. Player identity MUST be
temporary and scoped to a room session. The Worker MUST validate message size, nickname/category
limits, room capacity, ownership, and phase before mutation. Rooms MUST expose only phase-appropriate
data, expire after inactivity or completion, and never create global player profiles in the MVP.

### V. Simplicity and Observable Delivery

The project MUST prefer the smallest design that satisfies the specification. New dependencies,
Cloudflare bindings, persistent fields, and abstractions MUST have a documented purpose. Backend
errors MUST use stable machine-readable codes with safe user-facing messages. Deployments MUST
produce inspectable logs without logging private answer content unnecessarily.

## Architecture and Security Constraints

The frontend MUST be deployable as a static React/Vite build on GitHub Pages. The backend MUST run
on Cloudflare Workers with TypeScript and expose a WebSocket boundary. Each room MUST map to a Durable
Object, which serializes state and uses temporary SQLite storage. Production connections MUST use
HTTPS and WSS. Cloudflare credentials MUST be provided only through protected repository secrets.

The MVP MUST support no more than 20 active players per room, one active game per room, and no global
ranking or permanent account. The scoring contract is 10 points for a valid unique response, 5 for a
valid repeated response, 0 for empty or wrong-letter responses, half score for invalidation from 10%
through 50% inclusive, and zero above 50%.

## Development Workflow and Quality Gates

Work MUST proceed from specification to plan to tasks before implementation. Pull requests MUST keep
specification, plan, contracts, tests, and implementation aligned. Before merge, the project MUST
pass linting, type checking, domain tests, Worker/Durable Object tests, and relevant browser tests.
Frontend and backend deployments MUST be independently repeatable. Contract changes MUST document
compatibility behavior for already-open clients and update contract tests.

## Governance

This constitution is the highest-level project guidance. Every pull request MUST be checked against
these principles and constraints. Amendments MUST describe the reason, affected code, migration
impact, and test impact. Backward-incompatible governance changes require a MAJOR version bump; new
principles require MINOR; wording-only corrections require PATCH. The project owner approves
amendments through a reviewed pull request and the Sync Impact Report, version, and amendment date
MUST be updated in the same change.

**Version**: 1.2.0 | **Ratified**: 2026-09-08 | **Last Amended**: 2026-09-08
