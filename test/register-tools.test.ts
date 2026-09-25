import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import piMemory from "../extensions/index.ts";

type RegisteredTool = {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	parameters: {
		type: string;
		properties: Record<string, unknown>;
		required?: string[];
	};
	execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
};

type MemoryRequest = {
	id: string;
	from: string;
	to: string;
	kind: string;
	text: string;
	at: number;
};

function registerTools(): RegisteredTool[] {
	const tools: RegisteredTool[] = [];

	piMemory({
		registerTool(tool: RegisteredTool) {
			tools.push(tool);
		},
	} as never);

	return tools;
}

async function captureMemoryRequest(
	toolName: string,
	params: Record<string, unknown>,
): Promise<MemoryRequest> {
	const previousTeamDir = process.env.PI_TEAM_DIR;
	const previousTeamFrom = process.env.PI_TEAM_FROM;
	const teamDir = mkdtempSync(join(tmpdir(), "pi-memory-test-"));
	const repliesDir = join(teamDir, "replies");
	mkdirSync(repliesDir, { recursive: true });
	process.env.PI_TEAM_DIR = teamDir;
	process.env.PI_TEAM_FROM = "arman";

	try {
		const tool = registerTools().find((candidate) => candidate.name === toolName);
		assert.ok(tool);

		const executePromise = tool.execute("call-1", params);
		const requestPath = await waitForRequestPath(join(teamDir, "requests"));
		const request = JSON.parse(readFileSync(requestPath, "utf-8")) as MemoryRequest;
		writeFileSync(
			join(repliesDir, `${request.id}.json`),
			JSON.stringify({ id: request.id, text: "ok" }),
		);
		await executePromise;

		return request;
	} finally {
		if (previousTeamDir === undefined) {
			delete process.env.PI_TEAM_DIR;
		} else {
			process.env.PI_TEAM_DIR = previousTeamDir;
		}

		if (previousTeamFrom === undefined) {
			delete process.env.PI_TEAM_FROM;
		} else {
			process.env.PI_TEAM_FROM = previousTeamFrom;
		}
	}
}

async function waitForRequestPath(requestsDir: string): Promise<string> {
	const deadline = Date.now() + 2_000;

	while (Date.now() < deadline) {
		try {
			const { readdirSync } = await import("node:fs");
			const [file] = readdirSync(requestsDir).filter((entry) => entry.endsWith(".json"));

			if (file !== undefined) {
				return join(requestsDir, file);
			}
		} catch {
			// Directory may not exist before the tool creates it.
		}

		await new Promise((resolve) => setTimeout(resolve, 25));
	}

	throw new Error("Timed out waiting for memory request");
}

test("registers the three memory tools", () => {
	const tools = registerTools();

	assert.deepEqual(
		tools.map((tool) => tool.name),
		["memory_store", "memory_recall", "memory_forget"],
	);
});

test("registers the memory_store schema", () => {
	const store = registerTools().find((tool) => tool.name === "memory_store");

	assert.ok(store);
	assert.equal(store.parameters.type, "object");
	assert.deepEqual(store.parameters.required, ["note"]);
	assert.deepEqual(Object.keys(store.parameters.properties), ["note"]);
});

test("registers the memory_recall schema", () => {
	const recall = registerTools().find((tool) => tool.name === "memory_recall");

	assert.ok(recall);
	assert.equal(recall.parameters.type, "object");
	assert.equal(recall.parameters.required, undefined);
	assert.deepEqual(Object.keys(recall.parameters.properties), ["query", "limit"]);
});

test("registers the memory_forget schema", () => {
	const forget = registerTools().find((tool) => tool.name === "memory_forget");

	assert.ok(forget);
	assert.equal(forget.parameters.type, "object");
	assert.deepEqual(forget.parameters.required, ["match"]);
	assert.deepEqual(Object.keys(forget.parameters.properties), ["match"]);
});

test("memory_store writes the host mailbox payload", async () => {
	const request = await captureMemoryRequest("memory_store", { note: "ship it" });

	assert.equal(request.from, "arman");
	assert.equal(request.to, "host");
	assert.equal(request.kind, "memory");
	assert.equal(request.text, "store|||ship it");
});

test("memory_recall writes the query and limit payload", async () => {
	const request = await captureMemoryRequest("memory_recall", {
		query: "issue #3",
		limit: 7,
	});

	assert.equal(request.text, "recall|||issue #3|||7");
});

test("memory_forget writes the forget payload", async () => {
	const request = await captureMemoryRequest("memory_forget", { match: "stale" });

	assert.equal(request.text, "forget|||stale");
});
