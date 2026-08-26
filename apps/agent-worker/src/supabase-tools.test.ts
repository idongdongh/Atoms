import { describe, expect, it } from "vitest";
import {
  createTableSql,
  dbCreateTableTool,
  parseSupabaseEnv,
  physicalTableName,
} from "./supabase-tools.js";

const prefix = "9f3ab2c1";

describe("physicalTableName", () => {
  it("prefixes the project so apps cannot collide", () => {
    expect(physicalTableName(prefix, "todos")).toBe("a9f3ab2c1_todos");
  });
});

describe("createTableSql", () => {
  it("emits create table, RLS and a public CRUD policy", () => {
    const { table, sql } = createTableSql(prefix, {
      table: "todos",
      columns: [
        { name: "label", type: "text", required: true },
        { name: "done", type: "boolean" },
      ],
    });
    expect(table).toBe("a9f3ab2c1_todos");
    expect(sql).toContain(
      'create table if not exists public."a9f3ab2c1_todos"',
    );
    expect(sql).toContain('"label" text not null');
    expect(sql).toContain('"done" boolean');
    expect(sql).toContain("id uuid default gen_random_uuid() primary key");
    expect(sql).toContain("created_at timestamptz default now()");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain(
      'create policy "a9f3ab2c1_todos_all" on public."a9f3ab2c1_todos" for all to anon, authenticated using (true) with check (true)',
    );
  });

  it("rejects identifiers that could break out of the SQL string", () => {
    expect(() =>
      createTableSql(prefix, {
        // biome-ignore lint/suspicious/noExplicitAny: injection probe
        table: 'todos"; drop table users; --' as any,
        columns: [{ name: "label", type: "text" }],
      }),
    ).toThrow();
    expect(() =>
      createTableSql(prefix, {
        table: "todos",
        columns: [
          // biome-ignore lint/suspicious/noExplicitAny: injection probe
          { name: "a b (id int); drop table x", type: "text" as any },
        ],
      }),
    ).toThrow();
  });

  it("rejects column types outside the allowlist", () => {
    expect(() =>
      createTableSql(prefix, {
        table: "todos",
        // biome-ignore lint/suspicious/noExplicitAny: allowlist probe
        columns: [{ name: "payload", type: "bytea" as any }],
      }),
    ).toThrow();
  });

  it("rejects uppercase and leading-digit identifiers", () => {
    expect(() =>
      createTableSql(prefix, {
        table: "Todos",
        columns: [{ name: "label", type: "text" }],
      }),
    ).toThrow();
    expect(() =>
      createTableSql(prefix, {
        table: "1todos",
        columns: [{ name: "label", type: "text" }],
      }),
    ).toThrow();
  });
});

describe("parseSupabaseEnv", () => {
  it("requires all three credentials", () => {
    expect(parseSupabaseEnv({})).toBeNull();
    expect(
      parseSupabaseEnv({ ATOMS_SUPABASE_URL: "https://x.supabase.co" }),
    ).toBeNull();
    expect(
      parseSupabaseEnv({
        ATOMS_SUPABASE_URL: "https://x.supabase.co",
        ATOMS_SUPABASE_ANON_KEY: "anon",
        ATOMS_SUPABASE_SERVICE_ROLE_KEY: "secret",
      }),
    ).toEqual({
      url: "https://x.supabase.co",
      anonKey: "anon",
      serviceRoleKey: "secret",
    });
  });
});

describe("dbCreateTableTool", () => {
  it("is named db_create_table and asks for table plus columns", () => {
    expect(dbCreateTableTool.name).toBe("db_create_table");
    expect(dbCreateTableTool.parameters.required).toEqual(["table", "columns"]);
  });
});
