# Mongoose 5.13 → 7.x migration plan

`package.json` pins `mongoose@^5.13.23`. Mongoose 5 has been end-of-life since
2024 and carries three open advisories, one of them critical:

| Severity | Advisory | Patched in |
| --- | --- | --- |
| critical | Mongoose search injection | ≥ 6.13.6 |
| high | Improper sanitization of `$nor` in `sanitizeFilter` | ≥ 6.13.9 |
| moderate | Prototype pollution in update casting via `__proto__`-prefixed dotted path | ≥ 6.13.10 |

There is no fix on the 5.x line, so the only way to close them is to move up.

This is written as a plan rather than a patch on purpose. **Do not bump the
version until the gate in Stage 0 exists and passes.** The reason is in the
next section.

Line numbers below are as of the working tree at the time of writing. Each
section carries the grep that produced it; re-run it before acting.

---

## The gate: this cannot be verified by the suite we have

`yarn test` will pass on Mongoose 6 or 7 without proving anything. Every test
that touches a model either mocks the model outright (`jest.mock("../../models/…")`)
or builds a document and validates it in memory. **No test in the suite executes
a query against a MongoDB server**, and `mongodb-memory-server` is not a
dependency.

That matters because almost every breaking change below is in *query
behaviour*: which documents come back, what the write result looks like, and
whether an unknown filter path is honoured or silently dropped. None of that is
observable without a server.

Before Stage 2, there must be an integration suite that runs against a real
mongod (`mongodb-memory-server` in CI, or a disposable container) and covers at
minimum:

- `iCanSee` on `Project`, `Sample`, `Run` and `NewsItem` — for an admin, a
  member of one group, a `FULL_RECORDS_ACCESS_USERS` user, and a user with no
  groups. This is the permission boundary, and it is a *query filter*, which is
  exactly what `strictQuery` changes.
- `Group.GroupsIAmIn` with and without soft-deleted groups.
- The populate paths listed in section 2 — every one of them, because
  `strictPopulate` turns a typo into a thrown error at runtime rather than an
  empty field.
- One write of each shape: `updateOne`, `updateMany`, `deleteOne`,
  `findOneAndUpdate` with `{ new: true }`, and `save()` on a document with a
  `pre("validate")` hook (`Project`, `Run`).
- `lib/ingest-queue.js` `claimNextJob` against a real server, since the whole
  point of that function is an atomic `findOneAndUpdate` and the atomicity is a
  server property, not a mongoose one.

Until that exists, a version bump is a change nobody can review: the suite is
green either way.

---

## Blocker inventory

### 1. Connection and query options removed in Mongoose 6

Mongoose 6 dropped the deprecation-shim options entirely ("No More Deprecation
Warning Options"). They are not ignored — the driver rejects the unknown keys,
so the process fails at connect time.

```
grep -rn "useNewUrlParser\|useCreateIndex\|useUnifiedTopology\|useFindAndModify" --include="*.js" .
```

| Call site | Option | Action |
| --- | --- | --- |
| `server.js:364` | `useNewUrlParser: true` | delete |
| `server.js:365` | `useCreateIndex: true` | delete — see section 7 |
| `server.js:366` | `useUnifiedTopology: true` | delete |
| `add_default_groups.js:149` | `useNewUrlParser: true` | delete |
| `add_default_options.js:287` | `useNewUrlParser: true` | delete |

`serverSelectionTimeoutMS` at `server.js:367` is a driver option and stays.

**DONE:** `routes/projects.js` no longer passes `useFindAndModify: false`. It
was the one to look at twice — a *query* option on a `findByIdAndUpdate` rather
than a connection option, so no startup smoke test would have caught it. On
mongoose 5.13 the query now falls back to the global default (`true`), which
returns the driver's `findAndModify` DeprecationWarning to the logs until the
mongoose 6 bump. That is the trade this document's Stage 1 chose.

### 2. `execPopulate()` removed in Mongoose 6

In Mongoose 6 `doc.populate()` returns a promise directly and `execPopulate()`
no longer exists. Every one of these throws `TypeError: doc.populate(...).execPopulate is not a function`
on first use — at runtime, inside a `pre("save")` hook in most cases, which is
the worst place to find out.

```
grep -rn "execPopulate" --include="*.js" .
```

| Call site | Context |
| --- | --- |
| `models/Project.js:72` | `pre("validate")` path building |
| `models/Project.js:166` | `getRelativePath` |
| `models/Read.js:62` | post-save file populate |
| `models/AdditionalFile.js:54` | post-save file populate |
| `models/Run.js:115` | `pre("validate")` path building |
| `models/Run.js:192` | `getRelativePath` |
| `models/Sample.js:121` | `pre("validate")` path building |
| `models/Sample.js:225` | `getRelativePath` |

The rewrite is mechanical — `await doc.populate("file")` — and it is
**forward-compatible with Mongoose 5.13**, so it belongs in Stage 1.

### 3. `strictQuery` changes twice

- Mongoose 5: `strictQuery` is `false`. An unknown path in a filter is sent to
  MongoDB as-is.
- Mongoose 6: defaults to the value of `strict`, i.e. `true`. An unknown path
  in a filter is **silently stripped**.
- Mongoose 7: back to `false`.

A filter path that is silently dropped does not narrow the query, so the result
set gets *wider*. In this codebase the filters that matter are the permission
filters — `iCanSee` and `GroupsIAmIn` — where a dropped clause means returning
records the user may not see. That failure is invisible: no error, no log, just
more rows.

Do not rely on the default in either version. Set it explicitly next to
`mongoose.connect()` in `server.js` (`mongoose.set("strictQuery", false)`) so
the behaviour is the same before and after each bump, and the bump changes one
thing at a time.

### 4. Driver 4 write-result shapes (Mongoose 6)

`updateOne`/`updateMany` return `matchedCount`/`modifiedCount` instead of
`n`/`nModified`; `deleteOne`/`deleteMany` return `{ acknowledged, deletedCount }`.

```
grep -rn "\.updateOne(\|\.updateMany(\|\.deleteOne(\|\.deleteMany(" --include="*.js" .
```

| Call site | Reads the result? | Action |
| --- | --- | --- |
| `lib/ingest-queue.js:327` | yes — `result.nModified \|\| result.modifiedCount` | already handles both |
| `routes/options.js:91` | yes — `result.deletedCount` | unchanged in both |
| `lib/file-utils.js:250, 272, 276` | no | none |
| `lib/ingest-queue.js:190, 228, 251` | no | none |
| `routes/projects.js:224`, `routes/samples.js:313`, `routes/runs.js:388` | no | none |

Nothing here breaks. It is listed so the next person does not have to re-derive
that.

### 5. Callbacks dropped in Mongoose 7

Mongoose 7 removed callback support from every model and query method; passing
one throws.

```
grep -rn "function (err\|function(err\|(err, " --include="*.js" --exclude-dir=__tests__ .
```

**There are no callback-style mongoose calls in this codebase.** The four hits
are `app.js:267` and `routes/auth.js:169` (Express error handlers) and
`lib/ldap.js:125, 142` (ldapauth-fork callbacks). Neither is mongoose.

Every query is already `await`ed or `.then()`ed, including the nine `.exec()`
call sites (`routes/projects.js:74`, `routes/samples.js:34, 60, 100`,
`routes/runs.js:43, 67, 107`, `routes/search.js:62`).

### 6. Removed `Model.count()`, `Model.update()`, `Model.remove()`

```
grep -rn "\.count(\|\.update(\|\.remove(" --include="*.js" .
```

**No call sites.** The only hits are `crypto` hash `.update()` in
`lib/utils/md5.js:18` and the tus datastore's `remove()` in
`routes/uploads.js`, neither of which is mongoose. Nothing to do.

### 7. `autoCreate` and index builds (Mongoose 6)

`useCreateIndex` is gone (section 1) and `autoIndex`/`autoCreate` default to
`true`, so the API process asks the server to build any missing index at
startup. On a large collection that is a foreground cost paid during a deploy,
in the process that is meant to be answering health checks.

Before Stage 2, check what indexes the running database actually has against
the ones the schemas declare — `unique` on `models/User.js:4`,
`models/AdditionalFile.js:15`, `models/IngestJob.js:42`, and the `index: true`
paths in `models/IngestJob.js`. If any is missing in production, build it by
hand ahead of the deploy and set `autoIndex: false` for the app connection.

### 8. `findOneAndUpdate` return document — **not** a change

This is on the usual list of Mongoose 7 gotchas and it does not belong there.
Neither the Mongoose 6 nor the Mongoose 7 migration guide changes which
document `findOneAndUpdate()`/`findByIdAndUpdate()` returns: it is still the
document *before* the update unless `new: true` (or `returnDocument: "after"`)
is passed.

Checked anyway, because getting it wrong silently corrupts a response body:

| Call site | Uses the returned doc? | `new: true`? |
| --- | --- | --- |
| `routes/accessions.js:42` | yes | yes |
| `routes/projects.js:128` | yes (null check only) | yes |
| `lib/ingest-queue.js:106` | yes | yes |
| `lib/ingest-queue.js:153` | yes | yes |
| `lib/md5-verification.js` (9 sites) | no | n/a |
| `lib/file-utils.js:368, 411, 424` | no | n/a |
| `models/User.js:15` | no — and the `login` static is dead code, nothing calls it | n/a |

No action. Do not "fix" these by removing `new: true`.

### 9. `ObjectId` requires `new` (Mongoose 7)

```
grep -rn "Types.ObjectId(" --include="*.js" .
```

Every construction site already uses `new`, and all of them are in `__tests__`.
Production code only calls `mongoose.Types.ObjectId.isValid()`
(`routes/options.js:84`), which is unaffected. No action.

### 10. `Schema.Types.Mixed`

There is exactly one Mixed path in the codebase: `models/IngestJob.js:47`,
`payload`, which holds the slice of a request body an ingest needs to replay.

Mixed behaviour is not a 5→7 change, but it is the field most likely to be
blamed for one, so the two rules it has always had are worth writing down
before anyone goes looking:

- mongoose cannot detect an in-place mutation of a Mixed value. Anything that
  edits `job.payload.rawFiles` in place must call `job.markModified("payload")`
  before saving, or the write is a no-op. Today nothing mutates it — it is
  written once at enqueue and read back — and it should stay that way.
- Nothing is cast or validated inside `payload`, so it must never be used in a
  query filter. A user-supplied object reaching a filter is the shape of the
  critical search-injection advisory this migration exists to close.

### 11. Also inherited from the 6.x jump

Not blockers here, but they are the ones that bite in codebases like this one,
and each was checked:

- **`strictPopulate` (6)**: populating a path the schema does not know now
  throws. All 40 populate call sites name either a real path or a declared
  virtual — `samples`/`additionalFiles` (`models/Project.js:146, 153`),
  `additionalFiles`/`rawFiles` (`models/Run.js:167, 173`), `runs`/
  `additionalFiles` (`models/Sample.js:202, 209`). Clean, but this is the check
  that most needs the integration suite behind it.
- **Duplicate query execution (6)**: executing the same query object twice now
  throws. `Model.iCanSee(user)` returns a `Query` that callers chain onto
  (`routes/search.js:58`, `routes/runs.js:40`, `routes/projects.js:31`,
  `routes/news.js:53`); each awaits it once. Any future helper that returns a
  Query and hands it to two callers will now fail loudly instead of silently
  running twice.
- **`Model.exists()` returns a lean document instead of a boolean (6)**: no
  call sites.
- **Version requirements**: Mongoose 6 needs Node ≥ 12, Mongoose 7 needs
  Node ≥ 14.20.1. `.nvmrc` pins 24. Fine.

---

## Staged plan

### Stage 0 — build the gate (no version change)

Add the integration suite described above, running against a real mongod, and
wire it into CI as a separate job from `yarn test`. Land it on Mongoose 5.13 and
watch it pass there first: a suite written against the new version proves
nothing about the old one, and the point of this suite is to compare.

### Stage 1 — changes that are correct on 5.13 today (no version change)

All of these are forward-compatible, so they can land, deploy and bake
separately from the bump:

1. Replace the eight `execPopulate()` call sites (section 2) with
   `await doc.populate(…)`.
2. ~~Delete `useFindAndModify: false` at `routes/projects.js:131`.~~ **DONE** —
   `grep -rn "useFindAndModify" --include="*.js" .` is now empty.
3. Set `mongoose.set("strictQuery", false)` explicitly in `server.js` (section 3).
4. Confirm production indexes match the schemas (section 7).

Deploy and let it run. If something breaks, it breaks against a version whose
behaviour is already known.

### Stage 2 — 5.13 → 6.x

This is the real jump: it takes the MongoDB driver from 3.x to 4.x. Bump to the
latest 6.x (≥ 6.13.10, which clears all three advisories) and:

1. Delete the connection options (section 1).
2. Run the Stage 0 suite. Pay attention to permission filters first.
3. Watch a staging deploy for index builds at startup (section 7).

Bake this in production before Stage 3. Two majors in one deploy makes a
regression un-bisectable.

### Stage 3 — 6.x → 7.x

Smaller. `strictQuery` is already pinned, callbacks were never used,
`count`/`update`/`remove` have no call sites, and `ObjectId` is already
constructed with `new`. Re-run the greps in sections 5, 6 and 9 first in case
new code has appeared, then bump and run the Stage 0 suite.

### Stage 4 — 8.x

Out of scope. Revisit once 7.x has been in production for a release cycle.

---

## Rollback

Each stage is a single-commit revert plus a redeploy, with one caveat: Stage 2
changes the driver, and the driver is what talks to the server. If a rollback
is needed after a deploy that ran index builds, the indexes stay — they are
server state, not application state, and are harmless to leave in place.

Nothing in this plan changes a document's shape on disk, so no data migration
is involved and no backup needs restoring to go backwards.
