/**
 * DEUK Audit Shipper — Watches /data/audit for .jsonl files and ships to S3 (or keeps local).
 * Uses centralized @deuk/config for all configuration.
 */
import { readFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { parseConfig } from '@deuk/config';

const cfg = parseConfig(process.env);

const SINK_TYPE = process.env.SINK_TYPE || 'local';
const S3_BUCKET = cfg.S3_AUDIT_BUCKET;
const LOCAL_DIR = process.env.LOCAL_SINK_DIR || '/data/audit';
const AWS_REGION = cfg.AWS_REGION;

async function shipLocal(filePath) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    svc: 'audit-shipper',
    event: 'ship.local',
    file: filePath,
    bucket: S3_BUCKET,
    region: AWS_REGION,
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

console.log('[audit-shipper] Running. Sink:', SINK_TYPE, 'Dir:', LOCAL_DIR, 'Bucket:', S3_BUCKET, 'Region:', AWS_REGION);
