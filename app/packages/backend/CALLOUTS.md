# Opt-in public callout read model

This is a bounded, independently implemented backend feature, not original
backend source or qualified Pump compatibility. `GET /v1/callout/:calloutId`
assembles public Solana/EVM spot-token callouts from an explicitly supplied,
server-owned materialization. It joins author identity and visible author
updates, and optionally projects a quoted callout one level deep. There is no
default dataset, production request, database, price computation, wallet action,
or write endpoint. The same opt-in store now also serves a bounded canonical-author
list; see [CALLOUT-LIST.md](CALLOUT-LIST.md) for its separate contract and limits.

## Evidence and scope

The pinned developer OpenAPI is **0.294.0** at source checkpoint
`2fc654a20e9c7be2b9529f585942bb82c4c83ab2`.
`contracts/developer-bindings.json` binds `GET /callout/{calloutId}` to
`content.read`, the declared origin `https://api.pump.fun/v1`, and bearer auth.
The website request origin remains unresolved. Home/feed and profile routes are
in scope in `contracts/routes.json`; this does not implement the excluded
individual coin pages or turn a captured string into a production API probe.

| Evidence                                                                                                                                                    | Exact UTF-16 half-open range                       | Established behavior                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Factory `957263`, SHA-256 `9bf6001fe60fa67d0d941c7cac3f6d8b1b5eda390213e998bb00867c3ea0ba93`, in `2b47dd0b38a1608f.js`                                      | `[53841,88580)`; operation binding `[88274,88332)` | `publicRead("content.read")`, nullable legacy single-callout response and keyed errors                                                                                  |
| Factory `735821` (shared variants `917341`, `119675`), SHA-256 `bd59c4bee5702bebd7d5a2b91640d9ed9c3170493c0809861e33f4c926744f3d`, in `3740fc4e7a24596d.js` | `[1201,8886)`; call literal `[3530,3556)`          | Exact GET call with callout ID, preserves optional view/quote fields; client translates 404 into `{callout:null}` and reads `calloutPriceUsd` separately from SOL price |

Both paths are under `evidence/web/objects/`, captured at
`2026-10-28T10:48:45.546100+00:00` in the manifest. The complete objects are:

- 507,700 bytes, SHA-256 `e78d2f38b06f971847c18dd05457c75afc85208135f50d6e4022a5f197e8839d`.
- 67,649 bytes, SHA-256 `7400496d0194dea1be93f3640e73b3131f7e18d3e3d14fffb1ed117578795295`.

`test/callouts-evidence.test.ts` verifies full object hashes, exact factory
ranges, the operation literals, and unchanged qualification claims. Captured
JavaScript is decoded, sliced and hashed only, never evaluated. The client
imports factory `759257` (`e1c207697339004b48f6baa9f81f34e7644686ee424616b553e55b23c659b855`),
which composes contract client `30181` with URL provider `503630`; its runtime
origin selection and website credential semantics are not reconstructed.

### The 18-operation content denominator

At the pinned base, four `content.read` operations already have local post
handlers: `/posts`, `/posts/{postId}`, and its `/replies` and `/quotes` reads.
The post liker/reposter reads belong to another scope and do not increase this
content denominator. This change adds only the bounded single-callout slice.

The initial single-callout implementation left 13 operations outside its scope.
The later bounded `/callout/list/{userId}` slice is documented separately in
`CALLOUT-LIST.md`; the remaining 12 stay outside this store: `/callout/coin/{coin}`,
`/callout/leaderboard-stats/{userId}`,
`/callout/replies/list/{userId}`, `/callout/replies/{replyId}/chain`,
`/callout/reposts/list/{userId}`, `/callout/user/{userId}/mint/{coinMint}`,
`/callout/{calloutId}/quotes`, `/callout/{calloutId}/replies`,
`/callout/{calloutId}/tailers`, `/feed/video-feed`, `/home-feed`, and
`/home-feed/new`. The developer operations retain the existing fixture/501 harness. The separate
website home-feed adapter is not a developer `/home-feed` implementation. No
upstream list ranking, pagination default, PnL, tailing algorithm, or new-feed
cursor is inferred.

## Materialization contract (local design)

`CalloutsDataset` in `src/callouts-store.ts` defines an operator-facing input,
not a captured request format:

- `schemaVersion: 1`, explicit `synthetic` or `local-materialized` classification,
  and valid UTC `observedAt` (up to millisecond precision).
- Separate authors with exact `authorId` and the documented public identity
  fields. Group identity stays distinct from the acting admin's posting wallet:
  legacy `user_uuid` is the author's ID, while legacy `userId` comes from the
  supplied posting-wallet fact. Quote `userId` is the author ID and its
  `walletAddress` is the posting wallet. No identity/ownership lookup is inferred.
- Callout records with exact ID, author reference, explicit hidden/deleted flags,
  and legacy scalar facts. A `facts: null` record explicitly represents a local
  row that cannot be mapped. Duplicate IDs and unresolved authors fail admission.
- Separate update records with explicit author/callout references and visibility.
  Only visible, nondeleted author replies join. A joined update with a non-null
  `parentMessageId` must match its explicit callout reference; conflicting parents
  fail admission. Null parent knowledge remains null. Rows are sorted newest first;
  null times sort last and equal times use descending code-unit ID order. This
  tie/null policy is local, not a claim about upstream. The supplied update list
  may be a materialized window: social counters remain supplied facts and are
  never rewritten to the length of the visible window.
- Optional `quoteFacts` supplies the **separate** documented position-style
  callout projection. No SOL/USD or market-cap conversion is guessed. IDs,
  quote target and chain must agree with the target's legacy facts. The model
  joins the target's author and updates and always sets its own nested
  `quotedCallout` to null. A cycle therefore cannot recursively expand.
- Missing, hidden, deleted, unmappable or unprojected quote targets yield a null
  embed while the root's `quotedCalloutId` is preserved. This distinguishes an
  unavailable target from no quote. Optional `viewCount` remains absent when
  unknown; supplied real zero, nullable knowledge and optional media fields are
  retained without default filling.

Admission rejects unsupported fields, viewer liked/reposted stamps, nonfinite
numbers, unsafe/negative social counters, invalid calendar dates, prototype or
accessor fields, ambiguous identities, malformed references, and explicitly
non-spot asset payloads/chains. It accepts only chainless or Solana/EVM spot
facts. These stricter checks are local safety policy, not upstream validation
claims. Classifying data as public and accurate remains the materializer's
responsibility; a schema cannot prove authenticity, ownership or moderation
correctness. Inputs and returned nested objects are cloned. The store is
read-only until restart. The shared schema validator now tests own declared and
required keys, rather than inherited Object.prototype names; direct regressions
cover strict nested/ref validation and explicitly declared prototype-named keys.

## Runtime boundary

```sh
# From app/, after the backend build; the path is operator-owned, never from a request.
CALLOUTS_FILE=/absolute/operator-owned/callouts.json \
  node packages/backend/dist/server.js
```

The loader accepts a regular UTF-8 JSON file up to 8 MiB, rejects invalid data
before listening, and does not fetch URLs. Publish files by atomic replacement;
concurrent in-place writes are unsupported. A programmatic caller can supply
`buildApp([], { calloutsStore: new CalloutsStore(dataset) })`.

Without a configured store, existing explicit fixtures and 501 responses are
unchanged. With one, this route takes precedence over matching fixtures and
uses the existing developer-key **shape** gate. That gate is not credential
verification, scope enforcement or a website session. For the single-callout route, viewer query parameters
and all other nonempty queries return a local explicit 501 instead of pretending
their semantics are implemented. The entire suffix after the first `?` is checked,
so additional `?` characters (for example, `/v1/callout/a??userId=other`)
cannot silently discard unsupported query input. This applies to GET and HEAD.

A configured store returns `200 {"callout":null}` for absence in **that local
materialization**, hidden/deleted rows and explicitly unmappable rows. The
nullable 200 schema and the captured client's 404-to-null normalization support
the representation; they do **not** prove every production missing/hidden case
has HTTP 200. The production `CALLOUT_NOT_FOUND` error behavior remains
unqualified. An unknown local ID is not proof of absence on Pump.

All successful reads carry `X-Reconstruction-Data-Source`,
`X-Reconstruction-Observed-At` and `X-Reconstruction-Compatibility: unqualified`.
The timestamp is the import's observation stamp, not a fresh live observation.
The test-only synthetic builder is never registered by default. An actual
public data-producing adapter remains required.

## Validation and remaining limits

Tests exercise schema-conforming roots and group authors, quote cycles,
visibility, optional knowledge, author-only updates, duplicate/dangling
references, immutable reads, input privacy/admission, file loading, authentication
boundary, fixture precedence, unsupported requests and source provenance.

Historical single-callout patch checks (not a claim about the current aggregate):

- Backend `tsc -p tsconfig.json` build and `tsc --noEmit`: passed.
- `node --import tsx --test test/*.test.ts`: **348/348** backend tests passed,
  including **102** callout behavior/provenance tests.
- Progress rule unit tests: **8/8** passed. Progress freshness checking is blocked
  by the partial hydration's missing
  `packages/frontend/visual/portfolio-live-20261028/live-verification.json`.
- Full 67-operation binding verification and its unit suite are blocked by
  absent unrelated captured call-site objects (first: `GET /competitions`). The
  exact callout object/range/contract checks above pass independently.

Backend build/typecheck and the complete backend non-socket test run are the
applicable local checks. Full workspace build/tests/browser checks and complete
698-object evidence verification are not claimed for this narrow patch: the
working tree is a partial, pinned hydration and the frontend readiness gate is
separate. No live production, RPC, signing, wallet, authenticated account,
mutation or deployment checks are performed.

The coverage ledger records the opt-in local slice separately. Full-operation
native/qualified counts, developer contract bindings and feature-completion
milestones remain unchanged. This partial spot/public implementation is not
another fully reconstructed or compatibility-qualified API operation.
