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

## 12. `jsonwebtoken` upgraded 8.5.1 → 9.0.3

**Where:** `package.json`, `yarn.lock`

`8.5.1` carries known CVEs (CVE-2022-23539/23540/23541). This codebase only
uses `jwt.sign(payload, secret)` and `jwt.verify(token, secret)` with the
default HS256, all of which behave identically in 9.x.

**Token compatibility was verified, not assumed:** a token signed by 8.5.1 was
captured before the upgrade and confirmed to verify correctly under 9.0.3.
**No user needs to log in again.**

Side benefit: this also fixes the Node 25+ boot failure. `jsonwebtoken@9`
pulls `jws@4` → `jwa@2`, which only falls back to `buffer-equal-constant-time`
(the package that reads the removed `buffer.SlowBuffer`) when
`crypto.timingSafeEqual` is unavailable — and that has existed since Node 6.6.
The `jest.setup.js` shim added earlier in this branch is therefore removed.
The app now boots on Node 24 and Node 25.

---

## 13. `GET /accessions/csv` now requires full-records access (was: any login)

**Where:** `routes/accessions.js`, `routes/middleware.js`

The route was gated on `isAuthenticated` alone, and `getMatrixOfData` builds its
rows from `Run.find({})` and `Project.find({})` — no visibility filter. So **any
authenticated user could export every run and project in the database**,
including a user belonging to no group at all.

Measured against a `testuser` token (no `isAdmin`, no groups) before the change:

```
GET /runs           -> 0 runs      (correctly filtered by iCanSee)
GET /accessions/csv -> 2466 rows   (every run in the database)
```

It is now gated on the new `hasFullRecordsAccess` middleware, which admits
`isAdmin` tokens, the built-in `admin` user, and anyone named in
`FULL_RECORDS_ACCESS_USERS`. That is the same predicate `iCanSee` uses to decide
who may read across groups, so the export can no longer disclose more than its
caller is otherwise allowed to see.

**`isAdmin` was deliberately not used.** The people who use this export are ENA
admins listed in komondor-web's `ENA_ADMINS` (`deeks`, `macleand`, `taz23vul`);
their LDAP tokens carry no `isAdmin` claim, so an `isAdmin` gate would have
locked out every real user of the feature.

**Who is affected:** any caller not covered by `FULL_RECORDS_ACCESS_USERS` now
receives `403 {error}`. komondor-web is the only consumer — komondor-power does
not call this route — and its export page is already offered only to
`ENA_ADMINS`.

**Before deploying,** set `FULL_RECORDS_ACCESS_USERS` to the same usernames as
komondor-web's `ENA_ADMINS`. Note that this variable also grants cross-group
read access to projects, samples, runs and news items via `iCanSee` — it is
broader than the export alone. If that is too broad, the narrower option is a
separate `ENA_ADMIN_USERS` variable read only by this middleware.

**Rollback:** none — reverting reintroduces the disclosure.

---

## 14. Issued tokens now expire (was: valid forever)

**Where:** `lib/utils/jwtSign.js`

`jwt.sign` is now called with `expiresIn`, defaulting to `7d` and overridable
via `JWT_EXPIRES_IN` (any `ms`-style string: `12h`, `30d`, …).

This closes two problems at once. A leaked token is no longer valid forever.
And — the trigger for doing it now — group membership is baked into the token
at login, so a token issued while group resolution was broken (see the
August 2026 LDAP group-string incident) carried `groups: []` indefinitely and
kept returning 403 long after the underlying bug was fixed. An expiry bounds
how stale that snapshot can get.

**Who is affected:** every user, once per expiry period — the API returns 401
and komondor-web's interceptor redirects to sign-in (the groundwork from
item 5).

**Legacy tokens are refused outright.** Tokens issued before this change carry
no `exp` claim and would otherwise remain valid forever, so
`getUserFromRequest` now rejects any token without one (as a
`TokenExpiredError`, i.e. a 401). Deploying this signs out **every existing
session once** — including the stale empty-groups tokens from the August 2026
incident — with no action needed from users beyond signing in again. Deploy at
a quiet time: a 401 mid-upload pauses that upload.

---

## 15. LDAP user attributes are requested explicitly; single-group users can log in

**Where:** `lib/ldap.js`, `models/Group.js`

The login search now passes `searchAttributes` (exported as
`USER_SEARCH_ATTRIBUTES`) instead of relying on the server's default attribute
set, covering everything the app reads: `memberOf` for group resolution, plus
`displayName`, `company`, `mailNickname` and friends.

`GroupsIAmIn` also normalises `memberOf` before use. LDAP returns
single-valued attributes as plain strings, so a user in **exactly one** group
previously hit `user.memberOf.map is not a function` and could not log in at
all. A lowercase `memberof` attribute name is accepted too.

`scripts/ldap-diagnostic.js` (read-only) prints what the directory returns for
a username and which Mongo groups those `memberOf` values resolve to.

---

## 16. Read and write are now separate capabilities

**Where:** `models/Group.js`, `lib/utils/groupAccess.js`, `routes/middleware.js`,
`lib/utils/getUserForToken.js`, all route files

Three route files each carried their own copy of `userCanAccessGroup()`, and
every one of them used the same predicate for "may view this" and "may create
or edit this". `Group.GroupsIAmIn` now takes `{ mode: "read" | "write" }`, and
`lib/utils/groupAccess.js` is the single shared implementation
(`canReadGroup` / `canWriteGroup`, plus `requireGroupRead` / `requireGroupWrite`
middleware). The three local copies are gone.

**Who is affected:** users named in `FULL_RECORDS_ACCESS_USERS`. They hold a
cross-group *read* capability, but because every write check was built on the
same lookup, they could also **create and edit records in groups they are not
members of**. In write mode they now fall through to their real membership like
anyone else. Read breadth is unchanged.

Consequences worth knowing:

- **Soft-deleted groups no longer authorise anyone, admins included** — see
  §17.
- `isAdmin` is *not* a short-circuit in `canReadGroup` / `canWriteGroup`.
  Admin authority flows through `GroupsIAmIn`, which returns every live group,
  so "admins can do both" and "deleted groups authorise nobody" stay consistent
  rather than fighting. A test that mocks `GroupsIAmIn` to resolve `[]` for an
  admin now yields 403 — which is correct, because in reality an admin only
  gets `[]` when the group is deleted or absent.
- `belongsToGroup`'s 403 wording changed from "…to access this resource" to
  "…to modify this resource", and a request with no `req.user` now answers 401
  "Authentication required" instead of falling through to a 500. There are no
  route callers of it today.
- **`getUserForToken` now asks for the write capability** when stamping the
  token's `groups` claim. This is load-bearing, not cosmetic: in read mode a
  full-access user's token was stamped with *every* group id, and write mode
  reads that claim back as real membership — which would silently re-grant
  write-everywhere and undo the whole split.

---

## 17. Soft-deleted groups are filtered server-side

**Where:** `models/Group.js`, `routes/groups.js`

`GroupsIAmIn` now excludes groups with `deleted: true` in both modes, for
everybody. `GET /groups` no longer returns them, and they authorise nothing.
The filter is `deleted: { $ne: true }` so documents predating the field match.

`POST /groups/delete` and `/groups/resurrect` fetch via `Group.findById`, which
is not the filtered path, so a deleted group can still be resurrected.

**New:** an admin may pass `GET /groups?includeDeleted=true` to list them —
otherwise resurrect exists with no way to discover what to resurrect. A
non-admin sending it gets 403. **komondor-web's admin page must send this
parameter** or its "Deleted" tag can never appear.

---

## 18. Route authorisation and input-validation changes

**Where:** `routes/projects.js`, `routes/samples.js`, `routes/runs.js`,
`routes/accessions.js`, `routes/groups.js`, `routes/options.js`, `routes/users.js`

Malformed ObjectIds are now **400, not 500**, on `/project`, `/sample`,
`/samples/names/:projectId`, `/samples/new`, `/runs/names/:sampleId`, `/run`,
`/runs/:id/status` and `/runs/new`. The old 500 came from an unvalidated
request value reaching mongoose and surfacing a `CastError` through the
catch-all; the value now never reaches the query. An operator object such as
`?id[$ne]=null` is refused outright.

Note the id guard is a 24-hex-character test, deliberately stricter than
`mongoose.Types.ObjectId.isValid()`, which returns true for **any** 12-character
string (so `"project-1234"` and `"sample_names"` passed) and casts its bytes
into a garbage id.

Per endpoint:

- `GET /projects/names` now requires a bearer token. It previously handed every
  project name in the database to anonymous callers. It still returns names
  across all groups — `Project.name` is unique, so a client needs the full list
  for its "name already taken" hint. **Any pre-login page using it will now get
  401.**
- `PUT /project/toggle-nudgeable` now answers 403 outside the caller's writable
  groups, and 400 for a non-boolean `nudgeable`. It previously accepted any
  truthy value from any logged-in user for any project.
- `POST /projects/new` honours a boolean `nudgeable` and otherwise derives it
  from `Group.sendToEna` — see §19.
- `POST /samples/new` derives the stored group from the parent project. A
  `group` that does not own the submitted `project` is a 400; an unknown
  project is a **404**, a status this endpoint could not previously produce.
- `GET /samples/names/:projectId` is now group-gated and can answer 403/404.
- `GET /runs/names/:sampleId` requires read access to the sample's group and
  404s for an unknown sample; it previously answered for any id.
- `POST /runs/new` answers 400 when `group` does not own `sample`, and 403 when
  the caller has read but not write on the sample's group.
- `POST /accessions/new` now requires `FULL_RECORDS_ACCESS_USERS`/`isAdmin`
  rather than merely a token — an ordinary group member gets 403 — and
  **requires `accessions`**, where an omitted value used to be accepted as a
  silent no-op that changed nothing and returned 200.
- `POST /groups/edit` refuses `ldapGroups` from a non-admin with 403, and its
  non-member 403 wording changed to "…does not have permission to modify this
  resource". It also now applies only the fields the request actually carried:
  omitting `name` or `ldapGroups` previously set them to `undefined` and failed
  required-field validation as a 500.
- `POST`/`DELETE` on `/options/*` now require **admin**, not any valid token,
  and `OPTIONS_WRITE_REQUIRE_AUTH="false"` is ignored when `NODE_ENV` is
  production.
- `GET /users` and `GET /user` return fewer fields — see §20.
- `POST /logout` used to 404. It was registered with four parameters, which
  express treats as an error handler and skips during normal dispatch.

---

## 19. `Project.nudgeable` is derived from `Group.sendToEna`

**Where:** `routes/projects.js`

The hard-coded '2Blades' group ObjectId is gone. `POST /projects/new` now
honours a `nudgeable` sent as a **real JSON boolean**, and otherwise computes
`nudgeable = (targetGroup.sendToEna === true)`.

**DEPLOY-TIME DATA CHECK — please do not skip.** `add_default_groups.js` sets
`sendToEna: false` for **both** `two_blades` and `bioinformatics`. The old
hard-coded check only ever covered the first, so **new projects in
`bioinformatics` will now be created non-nudgeable** where they previously were
not. Any group document predating the field has `sendToEna` undefined and also
yields `nudgeable: false`. If that is wrong, the fix is data — set
`sendToEna: true` via `POST /groups/edit` — not code.

**komondor-power:** the `project_nudgeable` CSV column now reaches the database
on create, **but only as a real JSON boolean**. A string `"true"`/`"false"` is
discarded in favour of the group default, with a `[projects/new] Ignoring
non-boolean 'nudgeable'` warning in the logs. Check how that column serialises
before relying on it.

---

## 20. `GET /users` and `GET /user` return fewer fields

**Where:** `routes/users.js`

`GET /users` returned `User.find({})` — every field of every account — to any
authenticated caller, including `email`, `isAdmin` and `groups`: a ready-made
list of who to target and which groups they can reach. It is now projected to
`_id`, `username`, `name`.

It was **not** made admin-only, because komondor-power calls it as an ordinary
user during CSV upload to check that named project owners exist and reads only
`username`. komondor-web's admin list reads `_id`, `username`, `name`. The
projection is exactly that union.

`GET /user` is projected to `_id`, `username`, `name`, `email`, `company`.

Separately, `GET /user`'s `projects` list was an unfiltered
`Project.find({ owner })`, where `GET /projects` goes through the visibility
filter — making `?username=<anyone>` a way straight past it. It now composes
the visibility filter with the owner clause under `$and`. **komondor-web's
`pages/user/index.vue` will show fewer projects when viewing another user's
profile.** That is the fix, but it is a visible change.

**komondor-power:** `getAllUsers()` still works — `/users` keeps returning
`username`. Its `User` interface declares an optional `email` that `/users` no
longer returns; nothing reads it, but the type is now optimistic.

---

## 21. Run ingest is queued, not done inline

**Where:** `routes/runs.js`, `lib/ingest-queue.js`, `models/IngestJob.js`,
`server.js`

`POST /runs/new` previously did file movement, the overseer email and MD5
verification in a `setImmediate` callback fired *after* the response. A failure
there could reach nobody: it was logged and dropped, and the worker that could
retry it never saw it. The route now saves the run, **enqueues an ingest job
before responding**, and a background worker performs the work.

- The 201 and the idempotent 200 both gain `jobId`.
- `GET /runs/{id}/status` gains `ingest` (`null` when nothing was ever queued,
  which is what every pre-existing run looks like).
- A failed ingest is now *visible*: `ingest.status: "failed"` with `lastError`,
  instead of a run sitting at `pending` forever.
- A failed enqueue fails the request (and rolls back the run) rather than
  returning a 201 for an ingest nobody will run.

**Operationally: if the ingest worker is not started, runs created after this
change stay `pending` forever.** `server.js` wires `startIngestWorker()`; do
not disable it.

**komondor-power:** files now appear seconds-to-minutes after the 201 rather
than immediately. Poll `GET /runs/{id}/status` and read `ingest.status`.

---

## 22. `POST /runs/batch-status` accounts for every requested id

**Where:** `routes/runs.js`

The response gains `requested`, `missing` and `invalid`, and each entry gains
`ingest`. Previously runs the caller could not see were simply omitted, so a
client had no way to tell a filtered id from a complete answer.

**komondor-power must stop treating a short `runs` array as complete** and read
`missing` and `invalid` instead.

`missing` deliberately does not distinguish "no such run" from "exists but not
yours" — splitting them would make this an existence oracle for other groups'
run ids.

---

## 23. Stored TPlex CSV text is neutralised against formula injection

**Where:** `routes/samples.js`, `routes/accessions.js`

Values beginning `=`, `+`, `-`, `@`, tab or CR are prefixed with an apostrophe
and force-quoted, so a spreadsheet opening the export does not execute them.
Plain numbers (`-80`, `+4`) are exempt — a leading sign in front of a numeric
literal cannot execute anything, and quoting them would break numeric consumers.

Note this changes the **stored** text in `Sample.tplexCsv`, not just an export,
because `routes/samples.js` is where the CSV is serialised. A consumer that
round-trips `tplexCsv` should strip a leading `"'` when a field starts with one
of those characters.

`GET /accessions/csv` gets the same treatment. It is the endpoint that actually
produces a downloadable file, built from user-controlled names.

---

## 24. Configuration is validated at boot; the process refuses to start on a bad one

**Where:** `server.js`, `lib/utils/validateEnv.js`, `app.js`

An invalid configuration now **exits 1 at startup** instead of starting and
failing later at the first request that needed the missing value.

- `NODE_ENV=development` with a non-loopback `HOST` is refused outright.
  `routes/auth.js` still carries a `DEV_USERS` list gated only on `NODE_ENV`,
  so a development process must not be reachable off the machine. Production
  runs with `NODE_ENV` unset (see `ecosystem.config.js`), so the default bind
  stays `0.0.0.0` and nothing changes there.
- The **effective** MongoDB URI is validated — `MONGODB_URI` if set, otherwise
  the URI assembled from `MONGODB_PORT` — and must name a database. Requiring
  `MONGODB_URI` outright would have refused to start every existing deployment.
- Mount checks verify `DATASTORE_ROOT` and `HPC_TRANSFER_DIRECTORY` are
  readable, writable **and directories**: `fs.access` is happy with a plain
  file, and a stand-in file where a mount should be is a common shape of a
  mount that never came up.
- A loud SMTP TLS warning fires whenever `SMTP_HOST` is set, because
  `lib/utils/sendEmail.js` hardcodes `rejectUnauthorized: false`. It is
  truthful until that line changes.

**New `GET /ready`** reports readiness (database, mounts, ingest worker
freshness) and reports `draining` during shutdown. **`GET /health` no longer
implies the database is reachable** — it never truthfully did, but now it says
so by design.

**Deployment/monitoring config** (`nginx/`, `ecosystem.config.js`, any uptime
check) should point its "is the API usable" check at `/ready` and keep
`/health` only as a liveness/restart probe.

---

## 25. Uploads moved from `tus-node-server` to `@tus/server`

**Where:** `routes/uploads.js`, `package.json`

- `/uploads` answers **401 instead of 412** to unauthenticated callers.
- The upload `Location` URL changed shape from `//host/uploads/files/<id>` to
  `//host/uploads/<id>`. Clients that follow the `Location` header are
  unaffected; anything hardcoding the path is not.
- **Uploads in flight across the deploy cannot be resumed.** `@tus/server` v1
  keeps upload metadata in `<id>.json` sidecars in `files/`, where 0.3.2 kept
  it in `~/.config/configstore/tus-node-server-0.3.2.json`.
- Uploads already on disk have no recorded owner and so cannot be resumed or
  cancelled by anyone. Intentional — they were accepted anonymously.
- Upload ownership is **owner-only**; admins are not granted access to other
  users' uploads. Resuming another user's byte stream has no legitimate use.
- `POST /upload/cancel` was a no-op that ignored its input. With an `uploadId`
  it now validates the id, enforces ownership, releases the quota slot and
  deletes the partial. Without one it still returns 200 `{}`, preserving the
  current web client's behaviour.
- A path traversal was fixed: v1's default `getFileIdFromRequest` passes the
  last URL segment straight to the file store, so an encoded `..%2F` on DELETE
  could unlink outside the upload directory. The id is now restricted to
  `/^[0-9a-f]{32}$/`.

**komondor-web:** the upload client must now send the `Authorization` bearer
token on tus requests (tus-js-client's `headers` option). Without it every
upload fails with 401. Its origin must also match `WEB_APP_URL` exactly.

---

## 26. Record visibility is group membership alone, resolved live

**Where:** `lib/utils/fullAccessUsers.js`, `models/{Project,Sample,Run,NewsItem}.js`
— `iCanSee`, `routes/{projects,samples,runs,news,search,users}.js`

Two changes, both of which narrow what a caller sees.

**The `owner` clause is gone.** The visibility filter was
`{ $or: [{ owner: username }, { group: { $in: … } }] }` and is now
`{ group: { $in: … } }`. Owning a record was a permanent read grant that
removing somebody from a group could not withdraw — and `owner` was copied
verbatim out of `req.body` when a record was created, so a client could name
any username as the owner and hand that person access to a group they had never
been in. Owning a record now only ever narrows what group membership already
allows; every record model requires `group`, so nothing becomes unreachable.

`owner` is now stamped from the authenticated session on
`POST /projects/new`, `POST /samples/new` and `POST /runs/new`. The body field
is still accepted (and, on `/runs/new`, still required and type-checked) but its
value is ignored.

**Membership is re-derived from the database, not read off the token.**
`user.groups` is baked into the JWT at login, so a group soft-deleted afterwards
stayed in that claim for the rest of the token's life: the per-record routes
refused it (`GroupsIAmIn` filters `deleted`) while `/projects`, `/samples`,
`/runs`, `/news`, `/search` and `GET /user` went on serving its records. Those
endpoints now resolve live membership through the same path the per-record 403s
use.

**Who is affected:**

- A user removed from a group immediately stops seeing records they created
  there — where they previously kept seeing them until their token expired,
  and then indefinitely via the owner clause.
- A token carrying no groups now lists **nothing** from those endpoints, where
  it previously listed that user's own records.
- Anything inspecting or merging `.$or` on a visibility filter breaks. The only
  in-repo consumer is `routes/users.js`, which composes with `$and`.

**Cost:** one `Group.find` per list/search/news request, where the token claim
was free. It is the same query the per-record routes already make, and it is
what makes the two layers agree.

**API note for future callers:** `Model.iCanSee(user, groupIds)` takes the live
group ids as a required second argument and is deliberately **synchronous**. A
mongoose Query is a thenable, so an `async` static returning `Model.find(…)`
has the Query executed by the caller's `await` — the caller gets an array and
every `.populate()`/`.sort()` chain throws. Resolve the ids first with
`visibleGroupIds(user)`. Calling `iCanSee` with the user alone now throws a
`TypeError` rather than silently falling back to the stale claim.

**Rollback:** none for the owner clause — reverting reintroduces a
client-grantable read across groups.

---

## 27. Group rename is admin-only and refused once the datastore has content

**Where:** `routes/groups.js`, `models/Group.js`

Renaming a group changes its `safeName`, which is the first path component of
every project, sample and run underneath it. The directory move is a deliberate
out-of-band operation, so a rename that would strand data is now refused with
**409** whenever the group's datastore directory is non-empty.

The check fails closed: an unreadable or unset `DATASTORE_ROOT` refuses the
rename rather than allowing it, and a group whose `safeName` carries a `_2`
collision suffix is refused conservatively even where the directory would not
actually have moved.

**Who is affected:** admins. Anyone else now gets 403 for a rename at all.

---

## 28. A symlink at the leaf is refused on the file endpoints

**Where:** `routes/read-file.js`, `routes/directory-files.js`, `models/File.js`,
`lib/utils/md5.js`

`HPC_TRANSFER_DIRECTORY` is writable by unprivileged users by design (the
`hpc-mv` upload method), so a symlink planted there was an oracle over any file
the API process could read. A symlinked last path component is now refused on
all three endpoints **even when it points at a file that really is inside the
transfer directory**:

| Endpoint | Result |
| --- | --- |
| `GET /read-file` | `File does not exist` |
| `GET /directory-files` | `Directory does not exist` |
| `POST /directory-files/verify-md5` | 404 (403 if it escapes the root) |

`models/File.js` also refuses a source that is itself a symlink on the write
path: `O_NOFOLLOW` makes the open fail with `ELOOP` where `fs.link` previously
followed it.

**Who is affected:** any lab workflow that deliberately stages reads as symlinks
into `HPC_TRANSFER_DIRECTORY`. None was found in this repo, and the write path
already refused symlinked destinations, so this is consistent rather than novel
— but it is the change that would bite such a workflow.

`verify-md5` now returns **403** (not 404) for a path that escapes via symlink,
where it previously hashed the target. A caller treating 403 as fatal and 404 as
"not uploaded yet" will see a different code for a directory containing a
planted link.

`GET /directory-files/debug` gained an `isSymbolicLink` field, and its
`withinTransferDirectory` now reflects a symlink-resolved verdict rather than
`dirRoot !== null`. Additive, but an external ops tool parsing that response
should be told.

---

## 29. Staged uploads with no recorded owner can no longer be claimed

**Where:** `lib/file-utils.js`, `lib/upload-quota.js`

Claiming a staged upload — naming its id in `rawFiles`/`additionalFiles` on a
create — was the one operation on an upload that was never checked. The tus
endpoints and `/upload/cancel` both enforce ownership, so it was enforced
everywhere bytes are *written* and nowhere they are taken away: naming somebody
else's upload id linked their file into the claimant's datastore and unlinked it
from staging.

The claim now checks the tus sidecar's recorded owner, and an upload with **no**
recorded owner is refused rather than waved through — every upload the old
unauthenticated mount accepted looks exactly like that.

**Who is affected:** anyone with a staged upload predating the ownership
stamping. Those uploads are now unclaimable and must be re-uploaded. Check for
in-flight staged uploads before deploying.

**Note for the ingest queue:** the submitting username is recorded on the ingest
job's payload at enqueue time and used at claim time, which is the correct
semantics — the person who submitted the run is the person claiming their
uploads.

---

## 30. The `Read`/`AdditionalFile` row is written only after the bytes move

**Where:** `lib/file-utils.js`, `models/AdditionalFile.js`

The row used to be saved *before* the file was moved, and `AdditionalFile`'s
post-save hook moved the file and then swallowed the failure. A move that failed
(ENOSPC, EROFS, the no-clobber EEXIST) therefore left a row asserting the file
had arrived while it was still in staging — and everything downstream, including
the ingest queue's completion check, MD5 verification and the frontend's file
list, reads a row as proof of delivery.

The move now happens first and the row is written only if it succeeded; the
hook is skipped via `skipPostSave` so nothing moves twice. `AdditionalFile`'s
hook re-throws rather than resolving, so any remaining hook-driven move that
fails is at least visible.

**Who is affected:** nobody at the API surface. Operationally, a failed ingest
now fails loudly where it used to complete quietly with files missing.

**Note:** a run that failed *before* this change may already carry `Read` rows
for files still in staging. The ingest queue re-attempts those (it stats the
destination rather than trusting the row), and the re-attempt creates a second
`File`/`Read` pair — the stale one is deliberately left behind rather than
deleted on a retry path. Anything counting `Read`s per run will see both.

---

## 31. `{ sample, name }` is now a unique index on `Run` — check for duplicates first

**Where:** `models/Run.js`, `routes/runs.js`

`POST /runs/new` treats a hit on `Run.findOne({ sample, name })` as an
idempotent repeat and returns the existing run. Without a constraint that check
is advisory: two concurrent identical POSTs both miss the lookup, both insert,
and the second run queues a second ingest for the same source files — which can
only fail, the first having already moved them
(`File.moveToFolderAndSave` refuses to clobber a destination).

**Run this before deploying.** `mongoose` *logs* an index-creation failure
rather than throwing it, so a single existing duplicate means the index silently
never exists, the race stays open, and nothing anywhere reports a problem:

```js
db.runs.aggregate([
  { $group: { _id: { sample: "$sample", name: "$name" }, n: { $sum: 1 }, ids: { $push: "$_id" } } },
  { $match: { n: { $gt: 1 } } },
])
```

Resolve every hit (rename or remove the duplicate runs) before the deploy, then
confirm afterwards that the index exists:

```js
db.runs.getIndexes().filter((i) => i.name === "sample_1_name_1")
```

**API effect:** the losing side of a create race now gets an `E11000` from the
save instead of quietly writing a duplicate. `POST /runs/new` catches that,
re-reads `Run.findOne({ sample, name })` and returns the winner with the same
idempotent 200 body it already returns for a lookup hit — so clients see no
change. A duplicate key on any *other* index is still a 500.

---

## 32. The HPC staging area is a shared inbox — accepted risk, now audited

**Where:** `lib/utils/hpcAudit.js`, `lib/file-utils.js`,
`routes/directory-files.js`, `routes/read-file.js`

`HPC_TRANSFER_DIRECTORY` is a single flat inbox shared by every group. Nothing
in the schema records which group a staging subdirectory belongs to, and real
uploads arrive under names like `/WGS_Test/01.RawData` that carry no group at
all. **This was reviewed and deliberately kept as-is** rather than fixed, because
every fix imposes a directory naming convention on where users `scp` their reads
and would break the existing HPC workflow on the day it deployed.

**The attack this accepts**, spelled out so nobody rediscovers it as a surprise:

> Mallory has write access to group A only. She posts `/runs/new` for a sample
> in A with `rawFilesUploadInfo: { method: "hpc-mv", relativePath: "group_b" }`
> and `rawFiles: [{ name: "PATIENT_R1.fastq.gz" }]`. Directory and file names are
> discoverable because `GET /directory-files` accepts any `targetDirectoryName`.
> `createFileDocument` resolves `<HPC_ROOT>/group_b/PATIENT_R1.fastq.gz`, which
> is inside the root, so it is accepted — the only question the path guard asks
> is whether the path stays under the shared root, never *whose* directory it is.
> `moveToFolderAndSave` then hard-links the file into A's datastore and
> **unlinks the source**. Group B's sequencing data is now readable by every
> member of A, and is *gone* from B's inbox before B's own run-create ran.

So this is simultaneously cross-tenant disclosure and destruction of another
group's data, available to any legitimate user of any group.

**What was actually done instead.** Per-directory authorisation is not
implementable without the group↔directory mapping this decision declines to
introduce, so the two controls that *are* available were added:

1. **Attribution.** Every list, read, MD5 and claim against the staging area
   emits one `[HPC-AUDIT]` line naming the caller and the exact resolved path.
   A cross-group claim cannot be refused, but it can now be found afterwards.
   These go to **stdout**, not stderr — they are normal operation, and
   production splits the two streams.
2. **A groupless caller is refused.** `GET /directory-files`, `GET /read-file`
   and `POST /directory-files/verify-md5` previously gated on `isAuthenticated`
   alone, so a principal belonging to no group could enumerate the whole inbox.
   They now also require membership of at least one group. This is narrow — it
   cannot tell whether *this* group may read *that* directory — but it fails
   closed and it closes the only membership question the staging area can answer.

**If this is revisited**, the cheapest real fix is an allowlist on the `Group`
model (`hpcDirectories: [String]`), backfilled from what is on disk and run in
log-only mode until the backfill is verified. That preserves the existing
`/WGS_Test/01.RawData` layout, which a group-name-prefix rule would not.

---

## Known issues not addressed here
- `lib/fileUpload.js` is now **entirely unreferenced** — nothing in the repo
  requires it. It has been kept in working order (ported to the `@tus/server`
  v1 `Upload` shape, upload path corrected) rather than deleted, pending a
  decision on the tus flow. It cannot simply be wired into `onUploadFinish`:
  that would create a second `File` document for every upload alongside
  `lib/file-utils.js`'s `createFileDocument`. Deleting it is the cleaner
  outcome if the team agrees.
- **`routes/auth.js` `DEV_USERS` is gated only on `NODE_ENV === "development"`.**
  The containment added in §24 is network-level — development may only bind
  loopback. A second belt would be an explicit opt-in (e.g. `ALLOW_DEV_USERS=true`)
  before the list is consulted at all.
- **`Run.owner` is still taken from the request body**, not from
  `req.user.username`, and the read endpoints keep an `owner === req.user.username`
  bypass alongside the group check. Not an escalation today — creating a run
  still needs write access to the sample's group — but a client can name any
  owner it likes, which grants that user read on the run. Forcing `owner` to the
  authenticated user is a one-line change, deliberately not made because it
  changes what komondor-power submits.
- **`Sample.group` is assumed to equal `project.group`**, but nothing enforces
  that for existing documents. A one-off report of samples where the two differ
  would show whether the old handler was ever exploited. Not run.
- **`lib/utils/sendEmail.js` hardcodes `tls: { rejectUnauthorized: false }`.**
  Config validation now warns loudly about this on every boot where `SMTP_HOST`
  is set. The warning is truthful until that line changes: make verification the
  default and require an explicit opt-out (e.g.
  `SMTP_TLS_REJECT_UNAUTHORIZED=false`), then re-gate the warning on it.
- **`models/options/LibraryType.js` `indexed` is dead.** Nothing in `routes/`,
  `lib/` or `models/` sets or reads it — the only `indexed` consumers are
  `models/Read.js` and `lib/file-utils.js`, a different field on a different
  model. Either wire it to whatever was meant to consume it, or drop it from the
  schema. It was deliberately NOT added to the `/options/librarytype` write
  mapping: a settable field nothing reads is noise.
- **`Group.sendToEna` is member-editable.** Treated as cosmetic, and implemented
  that way, but it is the flag deciding whether a group's records go to a public
  external archive — a policy decision with an irreversible external
  consequence, not a display preference. Worth a look from whoever owns the ENA
  workflow.
- **`ldapjs` is deprecated upstream.** It is now correctly declared in
  `package.json` (it was previously undeclared and worked only by hoisting out
  of `ldapauth-fork`), but the package itself is decommissioned and will need
  replacing eventually.

---

## Dependency security backlog

In cost order. CI (`.github/workflows/ci.yml`) gates on **critical** advisories
keyed by advisory ID, with a documented `TRIAGED` map so a new critical fails
the build while the known unpatchable one is tracked with a reason. Clearing
these lets the gate ratchet up to fail-on-high; `nightly.yml` reports the
remaining count every morning.

| Advisory | Package | Fix | Cost |
| --- | --- | --- | --- |
| 1115527 (ReDoS) | `path-to-regexp` 0.1.12 | → 0.1.13, via a yarn resolution or an express bump | Cheapest win |
| 1121191, 1123478 | `nodemailer` 6.10.1 | → >= 9.0.1 | Major; changes API surface `lib/utils/sendEmail.js` uses |
| 1117404 (critical), 1118999 | `mongoose` 5.13.23 | → >= 6.13.9 | Large — see `MONGOOSE_MIGRATION.md` |

Notes:

- `yarn upgrade nodemailer` is a **no-op**: `package.json` pins `^6.10.1` and
  6.10.1 is already the newest 6.x. Clearing those advisories needs the major.
- The mongoose bump is the large one: `models/` uses `execPopulate()` (eight
  call sites, removed in Mongoose 6) and `server.js` uses `useCreateIndex` /
  `useNewUrlParser`. `MONGOOSE_MIGRATION.md` is the plan.
- **Correction to a premise carried into this work:** removing `tus-node-server`
  took the audit count from 121 to 116, not the bulk that was assumed. The
  actual bulk is `jest` (92 findings, devDependency only). Runtime findings are
  nodemailer 8, express 5, mongoose 3.
- The 4 reported criticals are a **single advisory** (1117404, mongoose) counted
  once per dependency path.
