#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { spawnSync } from "child_process";

// --- Configuration ---
const FIVE_HOUR_LIMIT = 5_000_000; // ~5M tokens per 5hr window (Pro plan)
const WEEKLY_LIMIT = 45_000_000; // ~45M tokens per 7-day window (Pro plan)
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const USAGE_FILE = join(dirname(new URL(import.meta.url).pathname), "usage.json");
const BAR_WIDTH = 10;

// --- ANSI Colors (256-color) ---
const color = (c: number, text: string) => `\x1b[38;5;${c}m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;

function barColor(pct: number): number {
  if (pct <= 50) return 70;   // green
  if (pct <= 75) return 178;  // yellow
  if (pct <= 90) return 208;  // orange
  return 196;                  // red
}

function progressBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const fg = barColor(clamped);
  return color(fg, "━".repeat(filled)) + color(238, "━".repeat(empty));
}

// --- Git helpers ---
function gitBranch(cwd: string): string {
  try {
    const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
      timeout: 2000,
    });
    return r.status === 0 ? r.stdout.trim() : "";
  } catch {
    return "";
  }
}

function gitDirty(cwd: string): boolean {
  try {
    const r = spawnSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf-8",
      timeout: 2000,
    });
    return r.status === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// --- Path shortening ---
function shortenPath(p: string, maxLen = 30): string {
  const home = homedir();
  let s = p.startsWith(home) ? "~" + p.slice(home.length) : p;
  if (s.length <= maxLen) return s;

  const parts = s.split("/");
  if (parts.length <= 3) return s;

  const head = parts.slice(0, 1);
  const tail = parts.slice(-2);
  return [...head, "…", ...tail].join("/");
}

// --- Duration formatting ---
function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

// --- Usage tracking ---
interface UsageEntry {
  ts: number;
  input: number;
  output: number;
  session: string;
}

interface UsageData {
  entries: UsageEntry[];
  lastSeen: Record<string, { input: number; output: number }>;
}

function loadUsage(): UsageData {
  try {
    if (existsSync(USAGE_FILE)) {
      const raw = readFileSync(USAGE_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {}
  return { entries: [], lastSeen: {} };
}

function saveUsage(data: UsageData): void {
  try {
    writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

function updateUsage(
  inputTokens: number,
  outputTokens: number,
  sessionId: string
): UsageData {
  const now = Date.now();
  const data = loadUsage();
  if (!data.lastSeen) data.lastSeen = {};

  // Prune entries older than 7 days
  data.entries = data.entries.filter((e) => now - e.ts < SEVEN_DAYS_MS);

  // Compute delta from last seen cumulative totals for this session
  const prev = data.lastSeen[sessionId] ?? { input: 0, output: 0 };
  const deltaInput = Math.max(0, inputTokens - prev.input);
  const deltaOutput = Math.max(0, outputTokens - prev.output);

  // Record the delta (only if there's new usage)
  if (deltaInput > 0 || deltaOutput > 0) {
    data.entries.push({
      ts: now,
      input: deltaInput,
      output: deltaOutput,
      session: sessionId,
    });
  }

  // Update last-seen cumulative values
  data.lastSeen[sessionId] = { input: inputTokens, output: outputTokens };

  // Clean up lastSeen for sessions with no recent entries
  const activeSessions = new Set(data.entries.map((e) => e.session));
  for (const sid of Object.keys(data.lastSeen)) {
    if (!activeSessions.has(sid)) delete data.lastSeen[sid];
  }

  saveUsage(data);
  return data;
}

function computeWindowStats(
  entries: UsageEntry[],
  windowMs: number,
  limit: number
): { pct: number; timeLeft: string } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const windowEntries = entries.filter((e) => e.ts >= cutoff);
  const totalTokens = windowEntries.reduce(
    (sum, e) => sum + e.input + e.output,
    0
  );
  const pct = Math.min(100, (totalTokens / limit) * 100);

  let timeLeft = "";
  if (windowEntries.length > 0) {
    const oldest = Math.min(...windowEntries.map((e) => e.ts));
    const ageOutMs = oldest + windowMs - now;
    timeLeft = formatTimeLeft(Math.max(0, ageOutMs));
  } else {
    timeLeft = formatTimeLeft(windowMs);
  }

  return { pct, timeLeft };
}

// --- Model version mapping ---
function modelVersion(id: string): string {
  if (id.includes("opus-4-6")) return "4.6";
  if (id.includes("opus-4-5")) return "4.5";
  if (id.includes("sonnet-4-5")) return "4.5";
  if (id.includes("sonnet-4-0")) return "4.0";
  if (id.includes("haiku-4-5")) return "4.5";
  if (id.includes("haiku-3-5")) return "3.5";
  if (id.includes("sonnet-3-5")) return "3.5";
  return "";
}

// --- Main ---
function main() {
  try {
    const input = readFileSync("/dev/stdin", "utf-8").trim();
    if (!input) {
      console.log("…");
      process.exit(0);
    }

    const data = JSON.parse(input);

    // Debug: dump raw JSON to inspect available fields
    try { writeFileSync(join(dirname(new URL(import.meta.url).pathname), "debug.json"), JSON.stringify(data, null, 2)); } catch {}

    // Extract fields safely
    const modelName: string = data?.model?.display_name ?? "Unknown";
    const modelId: string = data?.model?.id ?? "";
    const cwd: string = data?.workspace?.current_dir ?? process.cwd();
    const costUsd: number = data?.cost?.total_cost_usd ?? 0;
    const durationMs: number = data?.cost?.total_duration_ms ?? 0;
    const inputTokens: number = data?.context_window?.total_input_tokens ?? 0;
    const outputTokens: number = data?.context_window?.total_output_tokens ?? 0;
    const ctxPct: number = data?.context_window?.used_percentage ?? 0;
    const ctxSize: number = data?.context_window?.context_window_size ?? 0;
    const sessionId: string = data?.session_id ?? "unknown";

    // Git info
    const branch = gitBranch(cwd);
    const dirty = branch ? gitDirty(cwd) : false;
    const gitPart = branch
      ? color(70, "") + " " + bold(branch) + (dirty ? color(178, "*") : "")
      : "";

    // Path
    const shortPath = shortenPath(cwd);

    // Model + version
    const ver = modelVersion(modelId);
    const modelPart = modelName + (ver ? ` ${dim("v" + ver)}` : "");

    // Cost & tokens
    const inK = Math.round(inputTokens / 1000);
    const outK = Math.round(outputTokens / 1000);
    const costStr = `$${costUsd.toFixed(2)}`;

    // Duration
    const duration = formatDuration(durationMs);

    // Context bar + label
    const ctxBar = progressBar(ctxPct);
    const ctxLabel = `${Math.round(ctxPct)}%`;

    // Usage tracking
    const usage = updateUsage(inputTokens, outputTokens, sessionId);

    // L: 5-hour limit
    const limitStats = computeWindowStats(
      usage.entries,
      FIVE_HOURS_MS,
      FIVE_HOUR_LIMIT
    );
    const limitBar = progressBar(limitStats.pct);
    const limitLabel = `${Math.round(limitStats.pct)}%`;

    // W: weekly limit
    const weeklyStats = computeWindowStats(
      usage.entries,
      SEVEN_DAYS_MS,
      WEEKLY_LIMIT
    );
    const weeklyBar = progressBar(weeklyStats.pct);
    const weeklyLabel = `${Math.round(weeklyStats.pct)}%`;

    // --- Build output ---
    // Line 1: git • path • model
    const line1Parts = [gitPart, dim(shortPath), modelPart].filter(Boolean);
    const line1 = line1Parts.join(dim(" • "));

    // Line 2: S: $cost ↑Xk ↓Xk [ctx bar] ctx% (duration) • ctx used/total
    const tokenStr = `${dim("↑")}${inK}k ${dim("↓")}${outK}k`;
    const ctxUsedK = Math.round((ctxPct / 100) * ctxSize / 1000);
    const ctxTotalK = Math.round(ctxSize / 1000);
    const ctxBreakdown = dim(`${ctxUsedK}k/${ctxTotalK}k`);
    const line2 = `${dim("S:")} ${color(178, costStr)} ${tokenStr} [${ctxBar}] ${ctxLabel} ${dim("(" + duration + ")")} ${dim("•")} ${ctxBreakdown}`;

    // Line 3: L: [bar] % (time) • W: [bar] % (time)
    const limitPart = `${dim("L:")} [${limitBar}] ${limitLabel} ${dim("(" + limitStats.timeLeft + ")")}`;
    const weeklyPart = `${dim("W:")} [${weeklyBar}] ${weeklyLabel} ${dim("(" + weeklyStats.timeLeft + ")")}`;
    const line3 = `${limitPart} ${dim("•")} ${weeklyPart}`;

    console.log(line1);
    console.log(line2);
    console.log(line3);
  } catch (err) {
    // Fallback — never crash
    console.log(dim("status unavailable"));
  }
}

main();
