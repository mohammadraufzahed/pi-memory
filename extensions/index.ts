/**
 * pi-memory — structured memory tools for the pi coding agent.
 *
 * Souls actively curate their long-term memory instead of relying on
 * auto-harvested notes:
 *
 *   memory_store   — remember a fact (persisted by the host)
 *   memory_recall  — search your memories (optional query filter)
 *   memory_forget  — delete memories matching a substring
 *
 * Transport: the team mailbox ($PI_TEAM_DIR, default
 * ~/.local/state/telegram-agent/team) — kind="memory" requests are
 * answered by the host, which owns the journal store.
 *
 *   text field carries:  op ||| payload
 *     store:<note> | recall:<query> | forget:<substr>
 *
 * Env: PI_TEAM_FROM = the calling soul (memories are per-soul).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";

const DIR =
	process.env.PI_TEAM_DIR ??
	join(homedir(), ".local/state/telegram-agent/team");

async function memoryOp(op: string, payload: string): Promise<string> {
	const reqDir = join(DIR, "requests");
	const repDir = join(DIR, "replies");
	mkdirSync(reqDir, { recursive: true });
	mkdirSync(repDir, { recursive: true });
	const id = randomUUID();
	writeFileSync(
		join(reqDir, `${id}.json`),
		JSON.stringify({
			id,
			from: process.env.PI_TEAM_FROM ?? "unknown",
			to: "host",
			kind: "memory",
			text: `${op}|||${payload}`,
			at: Date.now(),
		}),
	);
	const file = join(repDir, `${id}.json`);
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (existsSync(file)) {
			try {
				const r = JSON.parse(readFileSync(file, "utf-8"));
				return String(r.text ?? "");
			} catch {
				/* partial write — retry */
			}
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	return "(memory request timed out)";
}

export default function piMemory(pi: ExtensionAPI) {
	pi.registerTool({
		name: "memory_store",
		label: "Memory Store",
		description:
			"Persist a fact to your long-term memory — user preferences, decisions, recurring bugs, learned facts about the system.",
		promptSnippet: "Remember a fact",
		parameters: Type.Object({
			note: Type.String({ description: "The fact to remember" }),
		}),
		async execute(_id, params) {
			const r = await memoryOp("store", params.note);
			return { content: [{ type: "text" as const, text: r }] };
		},
	});

	pi.registerTool({
		name: "memory_recall",
		label: "Memory Recall",
		description:
			"Search your long-term memories. Empty query = recent memories; with a query = substring filter.",
		promptSnippet: "Search your memories",
		parameters: Type.Object({
			query: Type.Optional(Type.String()),
			limit: Type.Optional(Type.Number()),
		}),
		async execute(_id, params) {
			const r = await memoryOp(
				"recall",
				`${params.query ?? ""}|||${params.limit ?? 10}`,
			);
			return { content: [{ type: "text" as const, text: r }] };
		},
	});

	pi.registerTool({
		name: "memory_forget",
		label: "Memory Forget",
		description:
			"Delete memories containing a substring — prune stale/wrong facts (e.g. 'issue #36' after it's deleted).",
		parameters: Type.Object({
			match: Type.String({ description: "substring to delete" }),
		}),
		async execute(_id, params) {
			const r = await memoryOp("forget", params.match);
			return { content: [{ type: "text" as const, text: r }] };
		},
	});
}
