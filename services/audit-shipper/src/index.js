/**
 * DEUK Audit Shipper — Minimal bootstrap version
 * Watches /data/audit for .jsonl files and ships to S3 (or keeps local).
 */
import { readFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';

const SINK_TYPE = process.env.SINK_TYPE || 'local';
const S3_BUCKET = process.env.S3_BUCKET || 'deuk-audit-local';
const LOCAL_DIR = process.env.LOCAL_SINK_DIR || '/data/audit';
const AWS_REGION = process.env.AWS_REGION || 'eu-west-1';

async function shipLocal(filePath) {
  // In local mode we just keep the file; in a real implementation we'd
  // batch and upload to S3 using @aws-sdk/client-s3.
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    svc: 'audit-shipper',
    event: 'ship.local',
    file: filePath,
  }));
}

async function processBatch() {
  try {
    const files = await readdir(LOCAL_DIR);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      const filePath = join(LOCAL_DIR, file);
      await shipLocal(filePath);
      // In production we'd delete after successful S3 upload.
      // await unlink(filePath);
    }
  } catch (err) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      svc: 'audit-shipper',
      event: 'error',
      error: err.message,
    }));
  }
}

// Run every 30 seconds
setInterval(processBatch, 30_000);
processBatch();

console.log('[audit-shipper] Running. Sink:', SINK_TYPE, 'Dir:', LOCAL_DIR);
