import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createHandlers } from "../handlers.js";

describe("vault_capture handler", () => {
  let tmpDir;
  let handlers;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pkm-cap-"));
    const vaultPath = path.join(tmpDir, "vault");
    await fs.mkdir(path.join(vaultPath, "05-Templates"), { recursive: true });
    await fs.writeFile(
      path.join(vaultPath, "05-Templates", "adr.md"),
      "---\ntype: adr\ncreated: <% tp.date.now(\"YYYY-MM-DD\") %>\ntags: []\n---\n# <% tp.file.title %>"
    );
    const { loadTemplates } = await import("../helpers.js");
    const templateRegistry = await loadTemplates(vaultPath);
    handlers = await createHandlers({
      vaultPath,
      templateRegistry,
      semanticIndex: null,
      activityLog: null,
      sessionId: "test-session"
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns queued acknowledgment with type and title", async () => {
    const handler = handlers.get("vault_capture");
    const result = await handler({
      type: "adr",
      title: "Test Decision",
      content: "We decided to test."
    });
    assert.equal(result.content[0].type, "text");
    assert.ok(result.content[0].text.includes("[adr]"));
    assert.ok(result.content[0].text.includes("Test Decision"));
    assert.ok(result.content[0].text.includes("Capture queued"));
  });

  it("includes type in response for all capture types", async () => {
    const handler = handlers.get("vault_capture");
    for (const type of ["adr", "task", "research", "bug"]) {
      const result = await handler({ type, title: "T", content: "C" });
      assert.ok(result.content[0].text.includes(`[${type}]`));
    }
  });

  it("throws when type is missing", async () => {
    const handler = handlers.get("vault_capture");
    await assert.rejects(
      () => handler({ title: "T", content: "C" }),
      { message: /type=\(missing\)/ }
    );
  });

  it("throws when title is missing", async () => {
    const handler = handlers.get("vault_capture");
    await assert.rejects(
      () => handler({ type: "adr", content: "C" }),
      { message: /title=\(missing\)/ }
    );
  });

  it("throws when content is missing", async () => {
    const handler = handlers.get("vault_capture");
    await assert.rejects(
      () => handler({ type: "adr", title: "T" }),
      { message: /content=\(missing\)/ }
    );
  });
});
