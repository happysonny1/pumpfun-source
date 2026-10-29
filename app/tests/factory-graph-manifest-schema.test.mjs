import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { GRAPH_VERSION, publishGraph, verifyGraph } from "../scripts/factory-graph/core.mjs";
import { fixture } from "./factory-graph-fixture.mjs";

const options = { routes: ["/"], targetLines: 4, maximumLines: 100 };

test("graph verification rejects missing, mistyped and unsupported manifest versions", async () => {
  const root = await fixture();
  try {
    await publishGraph(root, "research/graph", options);
    const path = join(root, "research/graph/MANIFEST.json");
    const original = await readFile(path, "utf8");
    const manifest = JSON.parse(original);
    const valid = await verifyGraph(root, "research/graph", options);
    assert.equal(valid.schemaVersion, GRAPH_VERSION);
    assert.equal(valid.sourceRebuildVerified, true);
    for (const version of [undefined, null, false, "1", 0, 2, 1.5]) {
      const changed = { ...manifest, schemaVersion: version };
      const bytes = JSON.stringify(changed);
      await writeFile(path, bytes);
      await assert.rejects(verifyGraph(root, "research/graph", options), /manifest schema/i);
      assert.equal(await readFile(path, "utf8"), bytes, "verification must not repair input evidence");
    }
    await writeFile(path, original);
    assert.deepEqual(await verifyGraph(root, "research/graph", options), valid);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("graph verification rejects malformed manifest envelopes explicitly", async () => {
  const root = await fixture();
  try {
    await publishGraph(root, "research/graph", options);
    const path = join(root, "research/graph/MANIFEST.json");
    for (const malformed of [null, [], {}, { schemaVersion: GRAPH_VERSION, files: {} }]) {
      await writeFile(path, JSON.stringify(malformed));
      await assert.rejects(verifyGraph(root, "research/graph", options), /manifest schema/i);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
