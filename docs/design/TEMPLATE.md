# Design Document: <Feature Name>

- **Date**: YYYY-MM-DD
- **Author**: <agent role / name>
- **Status**: Draft | Reviewed | Approved
- **Related Issues/PRs**: <links if any>

---

## 1. Summary

> 1-2 sentences. What is this change, in plain language?

Example: Add session-based authentication with JWT tokens, replacing the current cookie-based approach.

---

## 2. Problem / Motivation

> Why is this change needed? What problem does it solve? What are the current limitations?

- Current behavior: ...
- Desired behavior: ...
- Business/user impact: ...

---

## 3. Proposed Solution

> Detailed description of the approach. Be specific enough that a developer can implement this without asking follow-up questions.

### 3.1 Overview

<High-level description of the solution>

### 3.2 Architecture / Flow

<Describe the data flow, call sequence, or component interactions. Use ASCII art or Mermaid diagrams if helpful.>

```
User → Middleware → Auth Service → Database
```

### 3.3 Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| <What was decided> | <Choice made> | <Why this over alternatives> |

---

## 4. Affected Files

> List every file that will be created, modified, or deleted. Be specific — no globs or "etc."

### New Files
- `src/auth/session.ts` — Session management logic
- `src/auth/jwt.ts` — JWT token generation/validation

### Modified Files
- `src/middleware/auth.ts` — Update to use new session validation
- `src/routes/login.ts` — Switch to JWT response
- `src/types/user.ts` — Add Session type

### Deleted Files
- `src/auth/cookie.ts` — Remove old cookie-based auth (if applicable)

---

## 5. Interface / API Changes

> Define all new or changed function signatures, data structures, API endpoints, config changes.

### 5.1 Function Signatures

```typescript
// src/auth/session.ts
export function createSession(userId: string, ttl?: number): Session;
export function validateSession(token: string): Session | null;
export function revokeSession(token: string): void;
```

### 5.2 Data Structures

```typescript
interface Session {
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}
```

### 5.3 API Endpoints

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `{ token, expiresAt }` |
| POST | `/auth/logout` | Header: `Authorization: Bearer <token>` | `{ success: true }` |

### 5.4 Config / Environment Variables

- `JWT_SECRET` — Secret key for signing tokens (required)
- `SESSION_TTL` — Session duration in seconds (default: 3600)

---

## 6. Testing Plan

> How will this change be verified? Must be specific and executable.

### 6.1 Unit Tests
- [ ] `createSession` returns valid token with correct expiry
- [ ] `validateSession` returns null for expired tokens
- [ ] `validateSession` returns null for malformed tokens
- [ ] `revokeSession` invalidates token immediately

### 6.2 Integration Tests
- [ ] Login endpoint returns 200 with token for valid credentials
- [ ] Login endpoint returns 401 for invalid credentials
- [ ] Authenticated endpoint accepts valid token
- [ ] Authenticated endpoint rejects expired token (401)

### 6.3 Manual Verification
1. Start server, call POST /auth/login with test user → verify token returned
2. Use token to call GET /api/profile → verify 200 response
3. Wait for token expiry (or set short TTL) → verify 401
4. Call POST /auth/logout → verify subsequent calls return 401

### 6.4 Edge Cases
- Empty/missing token → 401
- Token signed with wrong secret → 401
- Concurrent sessions for same user → both valid until expiry
- Logout on already-revoked token → idempotent, returns 200

---

## 7. Risks & Alternatives

> What could go wrong? What other approaches were considered and why were they rejected?

### Risks
| Risk | Impact | Mitigation |
|---|---|---|
| JWT secret leaks | Tokens can be forged | Store in env var, rotate on deployment, add monitoring |
| Existing sessions break during migration | Users logged out | Implement fallback during rollout period |

### Alternatives Considered
1. **Continue using cookies**: Rejected because we need API-only mobile clients that don't support cookies.
2. **OAuth2 with external provider**: Rejected for MVP; overkill for internal tooling. May revisit later.

---

## 8. Open Questions

> List any unresolved questions. If none, explicitly state "None — all questions resolved."

- [ ] Should we support refresh tokens in v1? → No, deferred to v2.
- [ ] Rate limiting on login endpoint? → Yes, but separate design doc.
