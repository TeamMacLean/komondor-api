# Breaking changes — hardening refactor

Read this before deploying. `komondor-api` is consumed by other services
(komondor-web, komondor-power), and the changes below alter observable
behaviour. Everything else in the refactor is additive or internal.

Each entry says what changed, why, who is affected, and how to back it out.

---

## 1. Users with no group information now see nothing (was: everything)

**Where:** `models/Group.js` — `GroupsIAmIn`

`GroupsIAmIn` builds a mongoose filter from the user. When a user had no
`isAdmin` flag, no `groups` array and no LDAP `memberOf`, the filter was left as
`null` — and `Group.find(null)` is treated by mongoose as an empty filter, so
that user received **every group in the database**. Group membership feeds every
permission check in the API, so those users could read and write across all
groups.

It now returns `[]` for that case.

**Who is affected:** any account whose token carries no groups. To such a user
this will look like a total outage: `GET /groups` returns `[]`, and
`/projects`, `/samples`, `/runs` return nothing.

**Before deploying,** check whether any active account is in that state. If one
is, the fix is to populate its group membership (LDAP `memberOf` or the
`groups` claim), not to revert this.

**Rollback:** none — reverting reintroduces the privilege escalation.

---

## 2. `FULL_RECORDS_ACCESS_USERS` is now matched exactly (was: substring)

**Where:** `models/{Project,Sample,Run,NewsItem}.js` — `iCanSee`, via the new
`lib/utils/fullAccessUsers.js`

The check was:

```js
process.env.FULL_RECORDS_ACCESS_USERS.includes(user.username)
```

That is a **substring test against the raw environment string**. With
`FULL_RECORDS_ACCESS_USERS=["some","usernames","here"]`, a user called `s`,
`user`, `ere` or `me` matched and was granted unrestricted access to every
project, sample, run and news item. It also threw a `TypeError` — taking the
request down with a 500 — whenever the variable was unset.

Matching is now exact, against a parsed list (JSON array or comma-separated),
and a missing variable yields an empty list rather than an exception.

**Who is affected:** any user who only ever matched as a substring loses full
access. Users named in the list are unaffected.

**Rollback:** none — reverting reintroduces the privilege escalation.

---

## 3. `POST` / `DELETE` on `/options/*` now require authentication

**Where:** `routes/options.js`

`.all(isAuthenticated)` was commented out on all five option collections, so
**any unauthenticated caller could add or delete** library selections, sources,
strategies, types and sequencing technologies.

`GET` remains public, exactly as before. Only writes are gated.

**Who is affected:** any consumer that writes to `/options/*` without a bearer
token. It will now receive `401`.

**Rollback:** set `OPTIONS_WRITE_REQUIRE_AUTH="false"` to restore the previous
unauthenticated behaviour immediately, with no redeploy of consumers. Prefer
fixing the caller to send a token.

---

## 4. `DELETE /options/*` returns 404 when nothing matched (was: 200)

**Where:** `routes/options.js`

Also: a missing or malformed `id` now returns `400` instead of reaching the
database. This one is a bug fix with teeth — mongoose strips `undefined` from a
filter, so `deleteOne({ _id: undefined })` became `deleteOne({})` and **deleted
an arbitrary document** from the collection.

**Who is affected:** callers relying on delete being idempotent (always 200).

---

## 5. Bad or expired tokens now return 401 (was: 500)

**Where:** `app.js`

`getUserFromRequest` rejects on an invalid, expired or wrongly-signed JWT. That
rejection went to `next(err)`, and there was **no error-handling middleware
registered at all**, so it reached Express's default handler: a `500` with an
HTML body (including a stack trace outside production).

Every endpoint now returns `401 {error, detail}` as JSON for a bad token.

**Who is affected:** any consumer that treats 500 as "retry" and 401 as
"re-authenticate" will now behave correctly — but the status code on that path
has changed for every route.

Related: unknown paths now return `404` JSON instead of HTML, and malformed
JSON bodies return `400` JSON instead of an HTML parse error.

---

## 6. Search is now case-insensitive and runs in the database

**Where:** `routes/search.js`

The filter was `name.toLowerCase().includes(query)` against the **raw** query,
so any search term containing an uppercase letter could never match anything.
Searching "ABC" always returned zero results.

Matching is now a case-insensitive, escaped regex evaluated by MongoDB rather
than by loading every visible record into memory first.

**Who is affected:** searches that previously returned nothing will now return
results. Result sets grow. `/search` error responses changed from
`{"error":{}}` (an `Error` serialises to `{}`) to `{"error":"<message>"}`.

`/search/project`, `/search/sample` and `/search/run` still answer `200` with
`{results: []}` on failure — that contract is preserved — but now include an
`error` field so a failure is distinguishable from "no matches".

---

## 7. `GET /user` response shape changed

**Where:** `routes/users.js`

The handler spread a mongoose document directly (`{...foundUser}`), which
exposes internal fields — the JSON contained `$__` and `_doc` rather than the
user's own fields. It now calls `.toObject()`.

**Before:** `{user: {$__: {...}, _doc: {username, email, ...}, username, projects}}`
**After:** `{user: {_id, username, name, company, email, isAdmin, createdAt, updatedAt, __v, projects}}`

**Who is affected:** any consumer reading `user._doc.*`. They should read
`user.*` directly.

Also: a missing `username` parameter now returns `400` instead of `500`. The
old code sent a 500 **and then tried to send a second response**, crashing the
handler.

---

## 8. `/directory-files/debug` is now admin-only

**Where:** `routes/directory-files.js`

The response discloses `cwd`, `__dirname` and `HPC_TRANSFER_DIRECTORY` to any
authenticated caller. It now requires `isAdmin`.

The response fields `isAbsolute` and `resolvedPath` were removed;
`withinTransferDirectory` was added, and `dirRoot` may now be `null`.

**Note:** `isAdmin` is only present on tokens issued by the built-in `admin`
login (which has always set it) and, as of this change, on LDAP tokens. An LDAP
user holding a token issued *before* this deploy has no `isAdmin` claim and
must log in again.

---

## 9. Path traversal is now refused on the file endpoints

**Where:** `routes/read-file.js`, `routes/directory-files.js`

`GET /read-file` and `GET /directory-files` joined caller-supplied values onto
`HPC_TRANSFER_DIRECTORY` with no containment check, so
`?targetDirectoryName=../../..&filename=etc/passwd` read arbitrary files, and
an absolute `targetDirectoryName` replaced the root entirely (that is how
`path.resolve` works). `verify-md5` had a check, but `startsWith(hpcRoot)` also
accepts a sibling directory such as `<root>-evil`.

All three now resolve through `lib/utils/safePath.js`, which refuses traversal,
absolute segments, NUL bytes, sibling-prefix paths, and names that normalise
back to the root itself (`.`, `./`, `a/..`).

**Behaviour notes:**

- A rejected path returns `403`. `read-file` and `directory-files` otherwise
  keep their "always 200, signal failure via `body.error`" contract — a
  consumer that only inspects `body.error` at 200 will see an unhandled 403 on
  a traversal attempt. This was judged acceptable: no legitimate caller sends
  those paths.
- `GET /directory-files` now requires a non-empty `targetDirectoryName`.
  Previously omitting it threw a `TypeError` that surfaced as an error body, so
  no working caller depended on it.
- `read-file` gained a 5 MB size cap; larger files return an error rather than
  being read into memory synchronously.
- A leading slash on `filename` (`/reads.txt`) still works, as it did under
  `path.join`.

---

## 10. Accessions CSV fields are now quoted when they contain delimiters

**Where:** `routes/accessions.js`

Fields were joined with `,` and never escaped, so any group, project, sample or
run name containing a comma silently shifted every later column of that row
into the wrong heading. Fields containing `,`, `"`, CR or LF are now quoted
per RFC 4180.

The heading row's trailing comma is **preserved** deliberately, since consumers
parse the existing format.

Rows whose sample, group or project could not be resolved are now skipped with
a log line instead of failing the entire export with a `TypeError`.

`POST /accessions/new` now returns `400` for a non-ObjectId `typeId` (was a
`CastError` → 500) and for a non-array `accessions` (was silently accepted).

---

## 11. `isAdmin` is now included in LDAP-issued tokens

**Where:** `lib/utils/getUserForToken.js`

The function computed `const isAdmin = user.username === "admin"`, logged it,
and then **never included it in the returned payload**. It is now in the token.

This is what makes item 8 work. It also means `iCanSee` honours `isAdmin`,
which it never previously checked.

---

## Removed files

Dead code with no remaining `require` site:

- `lib/directories.js` — had no `module.exports` at all, so nothing could use it
- `lib/utils/moveRawFilesToFolder.js` — referenced an undefined variable `file`
  and would have thrown `ReferenceError` if ever called
- `lib/utils/moveAdditionalFilesToFolder.js`
- `lib/utils/toSafeName.js` — duplicated logic already inside `generateSafeName.js`

---

## Known issues not addressed here

- **`jsonwebtoken@8.5.1` has known CVEs.** Upgrading to `9.x` is recommended and
  is token-compatible for this codebase's HS256 usage, but it is a dependency
  change that deserves its own PR and verification.
- **The app cannot boot on Node 25+.** `buffer-equal-constant-time` (reached via
  `jsonwebtoken` → `jws` → `jwa`) reads the removed `buffer.SlowBuffer` at
  import time. `jsonwebtoken@9` does **not** fix this — it pulls the same
  package. `.nvmrc` pins Node 24, where it works. `jest.setup.js` shims it so
  the test suite runs on newer runtimes.
- **`ldapjs` was an undeclared dependency** — used by `lib/ldap.js` but absent
  from `package.json`, working only because it hoisted out of `ldapauth-fork`.
  It is now declared explicitly.
- `lib/fileUpload.js` is effectively dead: `routes/uploads.js` requires it but
  its only call site is commented out. Left in place pending a decision on the
  tus upload flow.
