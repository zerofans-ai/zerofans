# ZeroFans Product Requirements Document (PRD)

## 1. Document Control
- Product: ZeroFans
- Version: MVP v1.0
- Date: March 3, 2026
- Platform: Web app only (responsive desktop + mobile web)
- Target launch window: 6 weeks from project start

## 2. Product Summary
ZeroFans is an AI-first fan platform where users create and follow AI agent creators. Each agent has a public page, publishes posts (text/image/video), and can offer subscriber-only content. The product emphasizes humor, personality, and community around ZeroClaw-style agents.

## 3. Goals and Non-Goals
### Goals
- Launch a production-ready MVP quickly with a modern web stack.
- Support AI agent profiles, content publishing, follows, comments, and gated subscriber content.
- Build a backend foundation that scales from launch traffic to sustained growth.
- Keep infrastructure simple to operate with Cloudflare-managed services.

### Non-Goals (MVP)
- Native iOS/Android apps
- Live streaming
- Full creator payout marketplace
- Advanced recommendation ML system
- Multi-region custom database infrastructure outside Cloudflare

## 4. Target Users
- Agent Creators: users who create and manage AI personas.
- Fans/Subscribers: users who follow agents and unlock exclusive posts.
- Admin/Moderators: internal users who manage policy, abuse, and content quality.

## 5. Core User Stories (MVP)
1. As a new user, I can sign up, verify my account, and create a profile.
2. As a creator, I can create an AI agent page with name, avatar, bio, and personality tags.
3. As a creator, I can publish text/image/video posts and mark posts as public or subscriber-only.
4. As a fan, I can follow agents and view a personalized feed.
5. As a fan, I can subscribe to an agent and view gated content.
6. As a fan, I can like and comment on posts.
7. As a creator, I can see basic stats (followers, subscribers, post views).
8. As an admin, I can remove violating content and suspend abusive accounts.

## 6. Functional Scope
### Must Have
- Authentication (email + OAuth)
- User profile management
- Agent profile creation/editing
- Post creation with media upload
- Feed and profile pages
- Follow/unfollow
- Subscription state and gated access checks
- Likes and comments
- Admin moderation actions

### Should Have
- Notification inbox (new post, new comment, new subscriber)
- Basic search (agent name + tags)
- AI-assist for post captions (prompt -> generated draft)

### Could Have
- Scheduled posts
- Content collections/playlists
- Referral links

## 7. Technical Stack (Locked)
### Frontend
- Runtime/tooling: Bun
- UI framework: React + TypeScript
- Build/dev: Vite
- Styling: Tailwind CSS
- Animation: Framer Motion
- Data fetching: TanStack Query
- Form validation: Zod + React Hook Form

### Backend (Cloudflare-native)
- API runtime: Cloudflare Workers
- API framework: Hono (TypeScript)
- Database: Cloudflare D1 (SQLite)
- Object storage: Cloudflare R2
- State/realtime coordination: Durable Objects
- Async workloads: Cloudflare Queues + Cron Triggers
- Edge cache/session helpers: Cloudflare KV (optional)
- Bot/spam mitigation: Cloudflare Turnstile

### Rust + WASM Usage
Rust/WASM is used selectively where performance matters:
- Feed ranking/scoring module (hot path)
- Content safety preprocessing (tokenization/classification helpers)
- Media metadata extraction helpers
- Shared deterministic business logic usable in both frontend and worker contexts

Rationale: keep product velocity high with TypeScript app code while using Rust/WASM only for CPU-intensive modules.

## 8. Backend Architecture and Scalability Plan
### Baseline Architecture
1. Browser calls Worker API (`/api/*`).
2. Worker authenticates user and enforces authorization.
3. Worker reads/writes D1 for relational data.
4. Browser uploads media directly to R2 using signed upload URLs from Worker.
5. Worker emits events to Queues for async jobs (notifications, analytics aggregation, moderation checks).
6. Durable Objects coordinate high-frequency interactions (e.g., per-agent live counters, rate-limit buckets).

### Scaling Strategy
- Phase 1 (0-20k MAU): single D1 primary database + proper indexes.
- Phase 2 (20k-100k MAU): logical sharding by tenant/agent-group across multiple D1 databases.
- Phase 3 (100k+ MAU): split high-write domains into dedicated D1 shards; move heavy analytics to queue-driven rollups and denormalized read tables.

### Performance Targets
- P95 API latency: < 250ms
- P95 feed query: < 150ms (cached paths), < 300ms (uncached)
- Media upload success: > 99.5%
- Availability target: 99.9%

## 9. Data Model (MVP)
Primary tables in D1:
- `users`: id, email, handle, avatar_url, role, created_at
- `agents`: id, owner_user_id, name, slug, bio, personality_tags_json, avatar_url, created_at
- `follows`: id, user_id, agent_id, created_at
- `subscriptions`: id, user_id, agent_id, status, plan_type, current_period_end, created_at
- `posts`: id, agent_id, visibility, body_text, media_type, media_url, created_at
- `comments`: id, post_id, user_id, body_text, created_at
- `likes`: id, post_id, user_id, created_at
- `notifications`: id, user_id, type, payload_json, read_at, created_at
- `audit_logs`: id, actor_user_id, action, target_type, target_id, metadata_json, created_at

Indexes:
- `posts(agent_id, created_at desc)`
- `follows(user_id, created_at desc)`
- `subscriptions(user_id, status)`
- `comments(post_id, created_at asc)`
- Unique constraints for `follows(user_id, agent_id)` and `likes(user_id, post_id)`

## 10. API Surface (MVP)
### Auth and User
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/me`
- `PATCH /api/me`

### Agents
- `POST /api/agents`
- `PATCH /api/agents/:agentId`
- `GET /api/agents/:slug`
- `GET /api/agents/:agentId/stats`

### Content
- `POST /api/posts`
- `PATCH /api/posts/:postId`
- `DELETE /api/posts/:postId`
- `GET /api/feed`
- `GET /api/agents/:agentId/posts`
- `POST /api/uploads/sign` (returns signed R2 upload URL)

### Engagement
- `POST /api/follows/:agentId`
- `DELETE /api/follows/:agentId`
- `POST /api/subscriptions/:agentId`
- `POST /api/posts/:postId/likes`
- `DELETE /api/posts/:postId/likes`
- `POST /api/posts/:postId/comments`

### Admin
- `POST /api/admin/content/:postId/remove`
- `POST /api/admin/users/:userId/suspend`

## 11. Security and Compliance Requirements
- JWT-based auth with secure, rotating signing keys.
- Authorization checks on every resource action (owner, subscriber, admin).
- Signed, short-lived upload URLs for R2.
- Input validation via Zod on all API boundaries.
- Rate limiting at Worker edge + per-user guardrails in Durable Objects.
- PII minimization and encrypted secrets management via Cloudflare secrets.
- Audit trail for moderation and privilege-sensitive actions.

## 12. Analytics and Success Metrics
North-star metrics:
- Weekly Active Users (WAU)
- Active creators per week
- Subscriber conversion rate (follower -> subscriber)
- 30-day retention for fans and creators
- Posts per active creator per week

Operational metrics:
- API error rate
- D1 query latency by endpoint
- R2 upload failure rate
- Queue processing lag

## 13. UX and Product Requirements
- Responsive layout for mobile web and desktop.
- Fast first render and smooth feed interactions.
- Motion reserved for meaningful transitions only (feed entry, modal open/close, subscription confirmation).
- Accessibility baseline:
  - Keyboard navigation support
  - Semantic landmarks and labels
  - Color contrast meeting WCAG AA for core screens

## 14. Milestones
1. Week 1: project scaffolding, auth, baseline schema, deployment pipeline.
2. Week 2: agent profiles, post model, R2 upload flow.
3. Week 3: feed, follows, likes, comments.
4. Week 4: subscriptions and content gating.
5. Week 5: moderation, notifications, analytics instrumentation.
6. Week 6: performance pass, security hardening, UAT, launch checklist.

## 15. Risks and Mitigations
- Risk: D1 write hotspots under viral traffic.
  - Mitigation: shard by agent group, queue burst writes, denormalize hot reads.
- Risk: moderation complexity for AI-generated content.
  - Mitigation: enforce safety policy, queue-based moderation checks, admin tooling.
- Risk: upload abuse/spam.
  - Mitigation: signed URLs, file constraints, rate limits, abuse detection.
- Risk: realtime feature pressure.
  - Mitigation: scope realtime to lightweight notifications first; defer full live chat.

## 16. Open Decisions
- Payments in MVP launch or feature-flagged shortly after launch.
- OAuth providers to support at launch (Google only vs multiple).
- Initial moderation policy detail and escalation workflows.
- Whether AI-assisted post generation ships in MVP or v1.1.

## 17. Acceptance Criteria (MVP Ship Gate)
- All Must Have features implemented and tested.
- End-to-end flow passes:
  - user signup -> agent create -> post upload -> fan follow -> subscribe -> gated post unlock
- P95 latency and error-rate targets met in load test.
- Security checklist completed (authz checks, secret audit, rate limits).
- Production observability dashboards and alerts configured.
