# Mini Design Doc: <Bug / Small Change Title>

- **Date**: YYYY-MM-DD
- **Type**: Bug Fix | Small Change
- **Severity** (if bug): Critical | High | Medium | Low

---

## 1. Root Cause

> What causes the issue? Include file:line references and evidence (error messages, stack traces).

File: `src/path/to/file.ts:42`
The `user` field is `undefined` when `Session.expired` is true because `validateSession()` returns early without populating the user object.

**Error/Evidence**:
```
TypeError: Cannot read property 'id' of undefined
  at auth/validate.ts:42:18
```

---

## 2. Fix

> Describe the exact fix and why this approach is correct.

Add a null check before accessing `user.id`. If the session is expired or user is undefined, return 401 with `{ error: 'Session expired' }`.

---

## 3. Files Changed

| File | Change |
|---|---|
| `src/auth/validate.ts:42` | Add null check, return 401 |
| `src/middleware/session.ts:15` | Handle 401 response |

---

## 4. Test

> How will this be verified?

- [ ] Unit test: expired session returns 401
- [ ] Unit test: valid session returns 200
- [ ] Unit test: malformed token returns 401
- [ ] Manual: login → get token → wait for expiry → verify 401
