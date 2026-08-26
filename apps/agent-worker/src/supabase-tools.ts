import { z } from "zod";
import type { ModelToolDefinition } from "./model.js";

export type SupabaseConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

const identifierPattern = /^[a-z][a-z0-9_]*$/;
const allowedColumnTypes = [
  "text",
  "integer",
  "bigint",
  "numeric",
  "boolean",
  "uuid",
  "date",
  "timestamptz",
  "jsonb",
] as const;

const createTableArgs = z.object({
  table: z
    .string()
    .regex(identifierPattern, "lowercase letters, digits and underscores only")
    .max(40),
  columns: z
    .array(
      z.object({
        name: z.string().regex(identifierPattern).max(40),
        type: z.enum(allowedColumnTypes),
        required: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(24),
});

export type CreateTableInput = z.infer<typeof createTableArgs>;

export const dbCreateTableTool: ModelToolDefinition = {
  name: "db_create_table",
  description:
    "Create a database table for this project's persistent data. Returns the physical table name to use in code. Every table gets an id (uuid), created_at column and row-level security allowing the app frontend to read and write rows.",
  parameters: {
    type: "object",
    properties: {
      table: {
        type: "string",
        description:
          "Logical table name (e.g. todos, notes). A project prefix is added automatically.",
      },
      columns: {
        type: "array",
        description: "Data columns beyond the automatic id and created_at.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: [...allowedColumnTypes] },
            required: { type: "boolean" },
          },
          required: ["name", "type"],
          additionalProperties: false,
        },
      },
    },
    required: ["table", "columns"],
    additionalProperties: false,
  },
};

export function parseSupabaseEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseConfig | null {
  const url = env.ATOMS_SUPABASE_URL;
  const anonKey = env.ATOMS_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.ATOMS_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

export function physicalTableName(projectId: string, table: string): string {
  // Project prefix keeps every generated app's tables isolated in the shared
  // Supabase project; identifiers stay well under Postgres' 63-byte limit.
  return `a${projectId.replaceAll("-", "").slice(0, 8)}_${table}`;
}

export function createTableSql(
  projectId: string,
  input: unknown,
): { table: string; sql: string } {
  const parsed = createTableArgs.parse(input);
  const table = physicalTableName(projectId, parsed.table);
  const columnDefs = parsed.columns.map((column) => {
    const nullability = column.required ? " not null" : "";
    return `"${column.name}" ${column.type}${nullability}`;
  });
  const sql = [
    `create table if not exists public."${table}" (`,
    [
      "id uuid default gen_random_uuid() primary key",
      ...columnDefs,
      "created_at timestamptz default now()",
    ].join(", "),
    ");",
    `alter table public."${table}" enable row level security;`,
    `drop policy if exists "${table}_all" on public."${table}";`,
    `create policy "${table}_all" on public."${table}" for all to anon, authenticated using (true) with check (true);`,
  ].join(" ");
  return { table, sql };
}

export async function executeCreateTable(
  config: SupabaseConfig,
  projectId: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  const { table, sql } = createTableSql(projectId, input);
  const response = await fetch(`${config.url}/rest/v1/rpc/atoms_exec_sql`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_sql: sql }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Supabase rejected the table creation (${response.status}): ${body.slice(0, 300)}`,
    );
  }
  return {
    table,
    hint: `Use .from("${table}") with the supabase client from src/lib/supabase.ts for CRUD; the id, created_at columns are automatic.`,
  };
}
