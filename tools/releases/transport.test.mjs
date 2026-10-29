import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

let exchange;
try { ({ exchange } = await import("./transport.mjs")); } catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

test("request and binary payload arrive in order and receive a bounded result", async () => {
  assert.ok(exchange, "Bounded process transport is not implemented");
  const root = mkdtempSync(join(tmpdir(), "arden-transport-"));
  try {
    const archive = join(root, "archive");
    writeFileSync(archive, Buffer.alloc(10000, 7));
    const child = spawn(process.execPath, ["-e", `let chunks=[];process.stdin.on('data',x=>chunks.push(x));
      process.stdin.on('end',()=>{const data=Buffer.concat(chunks),end=data.indexOf(10);
      const header=JSON.parse(data.subarray(0,end));console.log(JSON.stringify({ok:true,result:{op:header.op,bytes:data.length-end-1}}));});`],
    { stdio: ["pipe", "pipe", "pipe"] });
    assert.deepEqual(await exchange(child, { op: "upload" }, archive), { op: "upload", bytes: 10000 });
  } finally { rmSync(join(root, "archive"), { force: true }); rmdirSync(root); }
});

test("early receiver rejection closes an in-progress upload without unhandled failures", async () => {
  assert.ok(exchange, "Bounded process transport is not implemented");
  const root = mkdtempSync(join(tmpdir(), "arden-transport-"));
  try {
    const archive = join(root, "archive");
    writeFileSync(archive, Buffer.alloc(4 * 1024 * 1024, 7));
    const child = spawn(process.execPath, ["-e", `console.log('{"ok":false,"error":"rejected"}');process.exit(1);`],
      { stdio: ["pipe", "pipe", "pipe"] });
    await assert.rejects(exchange(child, { op: "upload" }, archive));
  } finally { rmSync(join(root, "archive"), { force: true }); rmdirSync(root); }
});

test("a bounded migration block keeps only its safe status and migration IDs", async () => {
  assert.ok(exchange, "Bounded process transport is not implemented");
  const child = spawn(process.execPath, ["-e", `console.log(JSON.stringify({ok:false,error:"migration_blocked",
    status:"REQUIRES_OPERATOR",migration_ids:["0022_remove_old_data"]}));process.exit(1);`],
  { stdio: ["pipe", "pipe", "pipe"] });
  await assert.rejects(exchange(child, { op: "deploy" }), error => {
    assert.equal(error.code, "ARDEN_MIGRATION_BLOCKED");
    assert.equal(error.status, "REQUIRES_OPERATOR");
    assert.deepEqual(error.migrationIds, ["0022_remove_old_data"]);
    return true;
  });
});

test("untrusted receiver failure text is discarded", async () => {
  assert.ok(exchange, "Bounded process transport is not implemented");
  const child = spawn(process.execPath, ["-e", `console.log(JSON.stringify({ok:false,error:"migration_blocked",
    status:"DRIFT",migration_ids:["secret=private-password"]}));process.exit(1);`],
  { stdio: ["pipe", "pipe", "pipe"] });
  await assert.rejects(exchange(child, { op: "deploy" }), error => {
    assert.notEqual(error.code, "ARDEN_MIGRATION_BLOCKED");
    assert.doesNotMatch(error.message, /private-password/);
    return true;
  });
});

test("hung or oversized receiver responses fail within the transport boundary", async () => {
  assert.ok(exchange, "Bounded process transport is not implemented");
  const hung = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: ["pipe", "pipe", "pipe"] });
  await assert.rejects(exchange(hung, { op: "status" }, undefined, 100));
  const huge = spawn(process.execPath, ["-e", "process.stdout.write('x'.repeat(70000));"], { stdio: ["pipe", "pipe", "pipe"] });
  await assert.rejects(exchange(huge, { op: "status" }));
});

test("a missing transport executable is a handled failure", async () => {
  assert.ok(exchange, "Bounded process transport is not implemented");
  const missing = spawn("arden-nonexistent-ssh-transport", [], { stdio: ["pipe", "pipe", "pipe"] });
  await assert.rejects(exchange(missing, { op: "status" }));
});
