import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, type Fixture } from "../src/app.js";
import {
  CalloutsStore,
  loadCalloutsStore,
  type CalloutsDataset,
  type CalloutFacts,
  type QuoteFacts,
  type CalloutUpdate,
} from "../src/callouts-store.js";
import { assertSchema } from "../src/schema-validator.js";
const headers = { authorization: `Bearer pf_live_${"a".repeat(49)}` };
const now = "2026-10-28T00:00:00.000Z";
const spec = JSON.parse(
  readFileSync(
    new URL("../../../contracts/developer.openapi.json", import.meta.url),
    "utf8",
  ),
);
const responseSchema =
  spec.paths["/callout/{calloutId}"].get.responses[200].content[
    "application/json"
  ].schema;
function facts(id: string, extra: Partial<CalloutFacts> = {}): CalloutFacts {
  return {
    calloutId: id,
    userId: "synthetic-posting-wallet",
    coinMint: "synthetic-mint",
    marketCap: 100,
    calloutPrice: 0,
    calloutPriceUsd: 2,
    multiple: 1,
    createdAt: 0,
    maxPriceSol: 0,
    maxPriceUsd: 2,
    likes: 3,
    repostCount: 2,
    quoteCount: 1,
    updateCount: 20,
    commentCount: 4,
    replyCount: 24,
    maxMultiplier: null,
    maxMultiplierAt: null,
    mediaUrl: null,
    quotedCalloutId: null,
    ...extra,
  };
}
function quoteFacts(id: string, extra: Partial<QuoteFacts> = {}): QuoteFacts {
  return {
    calloutId: id,
    calledOutAtMcap: 120,
    multiple: 1,
    thesis: null,
    mediaUrl: null,
    calloutTimestamp: now,
    likes: 3,
    updateCount: 20,
    commentCount: 4,
    replyCount: 24,
    maxMultiplier: null,
    maxMultiplierAt: null,
    calloutPrice: 2,
    repostCount: 2,
    quoteCount: 1,
    actingUserId: null,
    actingUser: null,
    ...extra,
  };
}
function update(id: string, createdAt: string | null = now): CalloutUpdate {
  return {
    id,
    content: `Synthetic update ${id}`,
    createdAt,
    likeCount: 0,
    mediaUrl: null,
    parentMessageId: null,
    repostCount: 0,
  };
}
function dataset(): CalloutsDataset {
  return {
    schemaVersion: 1,
    dataSource: "synthetic",
    observedAt: now,
    authors: [
      {
        authorId: "author-a",
        userName: "Synthetic author",
        profileImage: null,
        isVerified: false,
        verifiedBadgeVisible: false,
        accountKind: "person",
        xUsername: null,
        xFollowerCount: 0,
      },
      {
        authorId: "group-b",
        userName: "Synthetic group",
        profileImage: null,
        isVerified: true,
        verifiedBadgeVisible: false,
        accountKind: "group",
        xUsername: null,
        xFollowerCount: 0,
      },
    ],
    callouts: [
      {
        calloutId: "a",
        authorId: "author-a",
        hidden: false,
        deleted: false,
        facts: facts("a", { quotedCalloutId: "b" }),
        quoteFacts: quoteFacts("a", { quotedCalloutId: "b" }),
      },
      {
        calloutId: "b",
        authorId: "group-b",
        hidden: false,
        deleted: false,
        facts: facts("b", {
          userId: "synthetic-acting-admin-wallet",
          quotedCalloutId: "a",
        }),
        quoteFacts: quoteFacts("b", { quotedCalloutId: "a" }),
      },
      {
        calloutId: "hidden",
        authorId: "author-a",
        hidden: true,
        deleted: false,
        facts: facts("hidden"),
      },
      {
        calloutId: "deleted",
        authorId: "author-a",
        hidden: false,
        deleted: true,
        facts: facts("deleted"),
      },
      {
        calloutId: "unmappable",
        authorId: "author-a",
        hidden: false,
        deleted: false,
        facts: null,
      },
    ],
    updates: [
      {
        calloutId: "a",
        authorId: "author-a",
        hidden: false,
        deleted: false,
        body: update("a-update", "2026-10-27T00:00:00Z"),
      },
      {
        calloutId: "a",
        authorId: "author-a",
        hidden: false,
        deleted: false,
        body: update("z-update"),
      },
      {
        calloutId: "a",
        authorId: "author-a",
        hidden: false,
        deleted: false,
        body: update("b-update"),
      },
      {
        calloutId: "a",
        authorId: "author-a",
        hidden: false,
        deleted: false,
        body: update("null-date", null),
      },
      {
        calloutId: "a",
        authorId: "author-a",
        hidden: true,
        deleted: false,
        body: update("hidden-update"),
      },
      {
        calloutId: "a",
        authorId: "author-a",
        hidden: false,
        deleted: true,
        body: update("deleted-update"),
      },
      {
        calloutId: "a",
        authorId: "other-author",
        hidden: false,
        deleted: false,
        body: update("not-author-update"),
      },
      {
        calloutId: "b",
        authorId: "group-b",
        hidden: false,
        deleted: false,
        body: update("group-update"),
      },
    ],
  };
}

test("single callout assembles author identity and visible author updates against the exact response schema", () => {
  const store = new CalloutsStore(dataset());
  const response = store.get("a");
  assertSchema(response, responseSchema, "response", spec);
  const callout = response.callout!;
  assert.equal(callout.user_uuid, "author-a");
  assert.equal(callout.userId, "synthetic-posting-wallet");
  assert.equal(callout.userName, "Synthetic author");
  assert.deepEqual(
    callout.updates.map((row) => row.id),
    ["z-update", "b-update", "a-update", "null-date"],
  );
  assert.equal(callout.hasLiked, null);
  assert.equal(callout.hasReposted, null);
  assert.equal(callout.updateCount, 20); // Stored counter is not invented from the supplied update window.
  assert.equal(callout.calloutPrice, 0);
  assert.equal(callout.calloutPriceUsd, 2);
});

test("group authors stay distinct from the acting posting wallet in roots and quoted projections", () => {
  const store = new CalloutsStore(dataset());
  const group = store.get("b").callout!;
  assert.equal(group.accountKind, "group");
  assert.equal(group.user_uuid, "group-b");
  assert.equal(group.userId, "synthetic-acting-admin-wallet");
  assert.equal(group.userName, "Synthetic group");
  const quote = store.get("a").callout!.quotedCallout!;
  assert.equal(quote.userId, "group-b");
  assert.equal(quote.walletAddress, "synthetic-acting-admin-wallet");
  assert.equal(quote.accountKind, "group");
  assert.equal(quote.callout.calloutPrice, 2);
  assert.equal(quote.callout.calledOutAtMcap, 120); // Separately materialized, not guessed from legacy marketCap.
  assert.equal(quote.callout.quotedCalloutId, "a");
  assert.equal(quote.callout.quotedCallout, null);
  assert.deepEqual(
    quote.callout.updates.map((row) => row.id),
    ["group-update"],
  );
  assertSchema({ callout: group }, responseSchema, "group", spec);
});

test("a cyclic quote graph is projected exactly one level and does not recurse", () => {
  const store = new CalloutsStore(dataset());
  for (const id of ["a", "b"]) {
    const result = store.get(id);
    assertSchema(result, responseSchema, "cyclic graph", spec);
    assert.equal(result.callout!.quotedCallout!.callout.quotedCallout, null);
  }
});

test("missing, hidden, deleted, unmappable and unprojected quote targets retain their target IDs", () => {
  for (const id of ["missing", "hidden", "deleted", "unmappable", "b"]) {
    const data = dataset();
    data.callouts[0].facts!.quotedCalloutId = id;
    data.callouts[0].quoteFacts!.quotedCalloutId = id;
    if (id === "b") delete data.callouts[1].quoteFacts;
    const result = new CalloutsStore(data).get("a");
    assert.equal(result.callout!.quotedCalloutId, id);
    assert.equal(result.callout!.quotedCallout, null);
    assertSchema(result, responseSchema, "unavailable target", spec);
  }
});

test("unknown/hidden/deleted/unmappable roots are absent in this configured materialization", () => {
  const store = new CalloutsStore(dataset());
  for (const id of ["missing", "hidden", "deleted", "unmappable"])
    assert.deepEqual(store.get(id), { callout: null });
});

test("optional knowledge is preserved without zero filling, including observed real zero", () => {
  const data = dataset();
  data.callouts[0].facts!.viewCount = 0;
  data.callouts[1].quoteFacts!.viewCount = 0;
  data.updates[0].body.viewCount = 0;
  data.callouts[0].facts!.mediaTranscript = "Synthetic transcript";
  const result = new CalloutsStore(data).get("a").callout!;
  assert.equal(result.viewCount, 0);
  assert.equal(result.quotedCallout!.callout.viewCount, 0);
  assert.equal(result.updates[2].viewCount, 0);
  assert.equal(result.mediaTranscript, "Synthetic transcript");
  for (const key of ["chain", "thesis", "assetClass", "perp"])
    assert.equal(Object.hasOwn(result, key), false);
  assert.equal(Object.hasOwn(result.updates[0], "viewCount"), false);
  assert.equal(
    Object.hasOwn(new CalloutsStore(dataset()).get("a").callout!, "viewCount"),
    false,
  );
});

test("input and output mutations cannot change later reads, including nested quoted updates", () => {
  const data = dataset();
  const store = new CalloutsStore(data);
  const before = store.get("a");
  data.authors[0].userName = "changed";
  data.callouts[0].hidden = true;
  data.updates[0].body.content = "changed";
  const read = store.get("a");
  read.callout!.updates[0].content = "changed";
  read.callout!.quotedCallout!.callout.updates[0].content = "changed";
  assert.deepEqual(store.get("a"), before);
});

test("opt-in route gates API keys, labels data, conforms to schema, and leaves other operations unimplemented", async () => {
  const data = dataset();
  data.dataSource = "local-materialized";
  const app = buildApp([], { calloutsStore: new CalloutsStore(data) });
  try {
    assert.equal((await app.inject({ url: "/v1/callout/a" })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          url: "/v1/callout/a",
          headers: { authorization: "Bearer malformed" },
        })
      ).statusCode,
      401,
    );
    const response = await app.inject({ url: "/v1/callout/a", headers });
    assert.equal(response.statusCode, 200);
    assertSchema(response.json(), responseSchema, "HTTP", spec);
    assert.equal(
      response.headers["x-reconstruction-data-source"],
      "local-materialized",
    );
    assert.equal(response.headers["x-reconstruction-observed-at"], now);
    assert.equal(
      response.headers["x-reconstruction-compatibility"],
      "unqualified",
    );
    assert.deepEqual(
      (await app.inject({ url: "/v1/callout/missing", headers })).json(),
      { callout: null },
    );
    for (const url of [
      "/v1/callout/a/quotes",
      "/v1/callout/a/replies",
    ]) {
      assert.equal((await app.inject({ url, headers })).statusCode, 501);
    }
    assert.equal(
      (await app.inject({ method: "POST", url: "/v1/callout/a", headers }))
        .statusCode,
      501,
    );
    const head = await app.inject({
      method: "HEAD",
      url: "/v1/callout/a",
      headers,
    });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, "");
  } finally {
    await app.close();
  }
});

test("no adapter preserves fixture/501 behavior; configured adapter wins without replaying a stale fixture", async () => {
  const fixture: Fixture = {
    method: "GET",
    path: "/v1/callout/a",
    status: 200,
    body: { stale: true },
    source: "synthetic test fixture",
  };
  const disabled = buildApp([fixture]);
  const enabled = buildApp([fixture], {
    calloutsStore: new CalloutsStore(dataset()),
  });
  try {
    assert.deepEqual(
      (await disabled.inject({ url: "/v1/callout/a", headers })).json(),
      fixture.body,
    );
    assert.equal(
      (await disabled.inject({ url: "/v1/callout/missing", headers }))
        .statusCode,
      501,
    );
    assert.equal(
      (await enabled.inject({ url: "/v1/callout/a", headers })).json().callout
        .calloutId,
      "a",
    );
    assert.equal(
      (await disabled.inject({ url: "/v1/callout/a" })).statusCode,
      401,
    );
  } finally {
    await disabled.close();
    await enabled.close();
  }
});

test("unsupported viewer and filter query semantics fail closed instead of being silently ignored", async () => {
  const app = buildApp([], { calloutsStore: new CalloutsStore(dataset()) });
  try {
    for (const query of [
      "userId=other",
      "limit=2",
      "x=1&x=2",
      "authorization=secret",
    ]) {
      const response = await app.inject({
        url: `/v1/callout/a?${query}`,
        headers,
      });
      assert.equal(response.statusCode, 501);
      assert.equal(response.json().reason, "CALLOUT_QUERY_UNSUPPORTED");
      assert.equal(response.body.includes("secret"), false);
    }
  } finally {
    await app.close();
  }
});

test("question marks inside the full callout query cannot bypass unsupported-query rejection", async () => {
  const app = buildApp([], { calloutsStore: new CalloutsStore(dataset()) });
  try {
    for (const query of ["?userId=other", "&?userId=other"]) {
      for (const method of ["GET", "HEAD"] as const) {
        const response = await app.inject({
          method,
          url: `/v1/callout/a?${query}`,
          headers,
        });
        assert.equal(response.statusCode, 501, `${method} ${query}`);
        if (method === "GET") {
          assert.equal(response.json().reason, "CALLOUT_QUERY_UNSUPPORTED");
          assert.equal(Object.hasOwn(response.json(), "callout"), false);
        } else assert.equal(response.body, "");
      }
    }
  } finally {
    await app.close();
  }
});

const invalid: Array<[string, (data: any) => void]> = [
  ["unknown top-level fields", (d) => (d.private = true)],
  ["unknown author fields", (d) => (d.authors[0].email = "private")],
  ["unknown root fields", (d) => (d.callouts[0].facts.private = "private")],
  ["viewer-liked root", (d) => (d.callouts[0].facts.hasLiked = true)],
  [
    "viewer-reposted quote",
    (d) => (d.callouts[1].quoteFacts.hasReposted = false),
  ],
  ["nested second quote", (d) => (d.callouts[1].quoteFacts.quotedCallout = {})],
  ["empty quote target", (d) => (d.callouts[0].facts.quotedCalloutId = "")],
  [
    "perpetual coin reference",
    (d) => (d.callouts[0].facts.coinMint = "hlcore:BTC"),
  ],
  ["nonfinite price", (d) => (d.callouts[0].facts.calloutPrice = Infinity)],
  ["negative view count", (d) => (d.callouts[0].facts.viewCount = -1)],
  ["fractional social count", (d) => (d.callouts[1].quoteFacts.likes = 1.5)],
  [
    "unsafe social count",
    (d) => (d.authors[0].xFollowerCount = Number.MAX_SAFE_INTEGER + 1),
  ],
  ["invalid observed date", (d) => (d.observedAt = "2026-02-30T00:00:00Z")],
  ["invalid update date", (d) => (d.updates[0].body.createdAt = "yesterday")],
  [
    "invalid quote date",
    (d) => (d.callouts[1].quoteFacts.calloutTimestamp = "2026-02-30T00:00:00Z"),
  ],
  ["negative epoch time", (d) => (d.callouts[0].facts.createdAt = -1)],
  ["private updater field", (d) => (d.updates[0].body.email = "private")],
  [
    "perpetual root",
    (d) => (d.callouts[0].facts.assetClass = "ASSET_CLASS_PERPETUAL"),
  ],
  ["collectible root", (d) => (d.callouts[0].facts.collectible = {})],
  [
    "perpetual quote",
    (d) =>
      (d.callouts[1].quoteFacts.perp = {
        side: "long",
        leverageBps: 10000,
        entryPx: null,
        closePx: null,
        closedAt: null,
      }),
  ],
  [
    "deferred quote chain",
    (d) => (d.callouts[1].quoteFacts.chain = "hlcore:mainnet"),
  ],
  [
    "unsupported root chain",
    (d) => (d.callouts[0].facts.chain = "near:mainnet"),
  ],
  ["duplicate authors", (d) => d.authors.push(d.authors[0])],
  ["duplicate callouts", (d) => d.callouts.push(d.callouts[0])],
  ["duplicate updates", (d) => d.updates.push(d.updates[0])],
  ["unresolved author", (d) => (d.callouts[0].authorId = "missing")],
  ["unresolved update callout", (d) => (d.updates[0].calloutId = "missing")],
  ["missing visibility", (d) => delete d.callouts[0].hidden],
  ["missing update visibility", (d) => delete d.updates[0].deleted],
  ["missing facts", (d) => delete d.callouts[0].facts],
  [
    "callout identity mismatch",
    (d) => (d.callouts[0].facts.calloutId = "other"),
  ],
  [
    "quote identity mismatch",
    (d) => (d.callouts[1].quoteFacts.calloutId = "other"),
  ],
  [
    "quote target mismatch",
    (d) => (d.callouts[1].quoteFacts.quotedCalloutId = "other"),
  ],
  [
    "quote chain mismatch",
    (d) => (d.callouts[1].quoteFacts.chain = "eip155:1"),
  ],
  ["quote without mapped facts", (d) => (d.callouts[1].facts = null)],
  ["malformed classification", (d) => (d.dataSource = "production-qualified")],
  ["null required data", (d) => (d.authors = null)],
  ["undefined input value", (d) => (d.callouts[0].facts.thesis = undefined)],
  [
    "prototype-related key",
    (d) =>
      Object.defineProperty(d, "__proto__", { value: {}, enumerable: true }),
  ],
];
for (const [name, change] of invalid)
  test(`materialization rejects ${name}`, () => {
    const data = dataset();
    change(data);
    assert.throws(() => new CalloutsStore(data));
  });

test("constructor rejects cycles, class instances, and accessor fields without reading them", () => {
  const cyclic: any = dataset();
  cyclic.loop = cyclic;
  assert.throws(() => new CalloutsStore(cyclic));
  assert.throws(() => new CalloutsStore(new Date()));
  const symbols: any = dataset();
  symbols[Symbol("hidden")] = "private";
  assert.throws(() => new CalloutsStore(symbols));
  const sparse = dataset();
  delete sparse.updates[0];
  assert.throws(() => new CalloutsStore(sparse));
  const list = dataset();
  let arrayRead = false;
  Object.defineProperty(list.updates, 0, {
    get() {
      arrayRead = true;
      return {};
    },
  });
  assert.throws(() => new CalloutsStore(list));
  assert.equal(arrayRead, false);
  const input = dataset();
  let read = false;
  Object.defineProperty(input, "secret", {
    get() {
      read = true;
      return "secret";
    },
    enumerable: true,
  });
  assert.throws(() => new CalloutsStore(input));
  assert.equal(read, false);
});

test("server-owned file loader accepts valid JSON, rejects malformed/oversize/non-regular input", () => {
  const dir = mkdtempSync(join(tmpdir(), "callouts-test-"));
  const file = join(dir, "materialized.json");
  try {
    writeFileSync(file, JSON.stringify(dataset()));
    assert.equal(loadCalloutsStore(file).get("a").callout!.calloutId, "a");
    writeFileSync(file, "not JSON");
    assert.throws(() => loadCalloutsStore(file));
    writeFileSync(file, Buffer.from([0xff]));
    assert.throws(() => loadCalloutsStore(file));
    truncateSync(file, 8 * 1024 * 1024 + 1);
    assert.throws(() => loadCalloutsStore(file), /at most 8 MiB/);
    assert.throws(() => loadCalloutsStore(dir), /regular file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Undeclared Object.prototype names must not bypass the public response schema.
for (const field of Object.getOwnPropertyNames(Object.prototype)) {
  for (const location of ["facts", "author", "quote", "update"] as const) {
    test(`materialization rejects inherited-schema field ${field} in ${location}`, () => {
      const data = dataset();
      const target =
        location === "facts"
          ? data.callouts[0].facts!
          : location === "author"
            ? data.authors[0]
            : location === "quote"
              ? data.callouts[1].quoteFacts!
              : data.updates[0].body;
      Object.defineProperty(target, field, {
        value: "undocumented-private-value",
        enumerable: true,
      });
      assert.throws(
        () => new CalloutsStore(data),
        /unsupported object field|property is not allowed/,
      );
    });
  }
}

test('public callout events cannot postdate the materialization checkpoint',()=>{
  const factsData=dataset();factsData.callouts[0].facts!.createdAt=Date.parse('2026-10-29T00:00:00Z');
  assert.throws(()=>new CalloutsStore(factsData),/observedAt/);
  const updates=dataset();updates.updates[0].body.createdAt='2026-10-29T00:00:00Z';
  assert.throws(()=>new CalloutsStore(updates),/observedAt/);
  assert.doesNotThrow(()=>new CalloutsStore(dataset()));
});

test("author update joins reject a conflicting explicit parent message", () => {
  for (const parent of ["b", "missing-parent", ""]) {
    const data = dataset();
    data.updates[0].body.parentMessageId = parent;
    assert.throws(() => new CalloutsStore(data), /update parent.*callout/i);
  }
});

test("matching and unknown update parents retain root, list and quoted HTTP projections", async () => {
  const data = dataset();
  data.updates[0].body.parentMessageId = "a";
  const groupUpdate = data.updates.find(row => row.calloutId === "b")!;
  groupUpdate.body.parentMessageId = "b";
  const app = buildApp([], { calloutsStore: new CalloutsStore(data) });
  try {
    const rootResponse = await app.inject({ url: "/v1/callout/a", headers });
    const listResponse = await app.inject({ url: "/v1/callout/list/author-a", headers });
    assert.equal(rootResponse.statusCode, 200);
    assert.equal(listResponse.statusCode, 200);
    const root = rootResponse.json().callout;
    const listed = listResponse.json().callouts.find((row: any) => row.calloutId === "a");
    for (const row of [root, listed]) {
      assert.equal(row.updates.find((value: any) => value.id === "a-update").parentMessageId, "a");
      assert.equal(row.updates.find((value: any) => value.id === "z-update").parentMessageId, null);
      assert.equal(row.updateCount, 20);
      assert.equal(row.quotedCallout.callout.updates[0].parentMessageId, "b");
    }
    assertSchema(rootResponse.json(), responseSchema, "matching update parents", spec);
  } finally {
    await app.close();
  }
});
