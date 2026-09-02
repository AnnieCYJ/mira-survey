// 端侧记忆层（移植自 mira-ios/Sources/Models/MemoryStore.swift）
// SQLite + FTS5 持久化，中文 2/3-gram + 英文词建索引；无 FTS5 自动降级普通表 + LIKE 检索。
// 上限 MAX_MEM 条，跨会话语义检索（MATCH + 时间衰减重排）。

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'mira_memory.db';
const MAX_MEM = 300;

type Row = { orig: string; ts: number };

export class MemoryStore {
  private db: SQLite.SQLiteDatabase | null = null;
  private useFTS = true;
  private ready: Promise<SQLite.SQLiteDatabase> | null = null;

  open(): Promise<SQLite.SQLiteDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      const ftsOK = await this.exec(db, `CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(
        tokens, user_id UNINDEXED, orig UNINDEXED, ts UNINDEXED);`);
      if (ftsOK) {
        this.useFTS = true;
      } else {
        this.useFTS = false;
        await this.exec(db, `CREATE TABLE IF NOT EXISTS mem_plain (
          id TEXT PRIMARY KEY, user_id TEXT, text TEXT, tokens TEXT, ts INTEGER);`);
      }
      this.db = db;
      return db;
    })();
    return this.ready;
  }

  private async exec(db: SQLite.SQLiteDatabase, sql: string): Promise<boolean> {
    try {
      await db.execAsync(sql);
      return true;
    } catch (e) {
      console.warn('[MemoryStore] exec failed:', sql, e);
      return false;
    }
  }

  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    const ascii = text.toLowerCase().match(/[a-z0-9]+/g) || [];
    tokens.push(...ascii);
    const cjk = text.match(/[一-龥]/g) || [];
    const s = cjk.join('');
    for (let i = 0; i < s.length - 1; i++) tokens.push(s.slice(i, i + 2));
    for (let i = 0; i < s.length - 2; i++) tokens.push(s.slice(i, i + 3));
    return Array.from(new Set(tokens)).slice(0, 200);
  }

  async add(text: string, userId = 'default'): Promise<void> {
    const db = await this.open();
    const tokens = this.tokenize(text).join(' ');
    const ts = Date.now();
    const id = `${userId}-${ts}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      if (this.useFTS) {
        await db.runAsync(
          `INSERT INTO mem_fts (tokens, user_id, orig, ts) VALUES (?,?,?,?)`,
          [tokens, userId, text, ts]
        );
      } else {
        await db.runAsync(
          `INSERT INTO mem_plain (id, user_id, text, tokens, ts) VALUES (?,?,?,?,?)`,
          [id, userId, text, tokens, ts]
        );
      }
      await this.trim(db);
    } catch (e) {
      console.warn('[MemoryStore] add failed:', e);
    }
  }

  async recall(text: string, topK = 3): Promise<string[]> {
    const db = await this.open();
    const toks = this.tokenize(text);
    if (toks.length === 0) return [];
    let rows: Row[] = [];
    try {
      if (this.useFTS) {
        const q = toks.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
        rows = await db.getAllAsync<Row>(
          `SELECT orig, ts FROM mem_fts WHERE mem_fts MATCH ? ORDER BY rank LIMIT 30`,
          [q]
        );
      } else {
        const like = toks.map((t) => `tokens LIKE '%${t.replace(/[%/_]/g, '')}%'`).join(' OR ');
        rows = await db.getAllAsync<Row>(`SELECT text AS orig, ts FROM mem_plain WHERE ${like} LIMIT 30`);
      }
    } catch (e) {
      console.warn('[MemoryStore] recall failed:', e);
      return [];
    }
    const now = Date.now();
    const scored = rows.map((r) => ({
      orig: r.orig,
      score: Math.exp(-((now - r.ts) / 86400000) / 14), // 两周半衰期
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.orig);
  }

  private async trim(db: SQLite.SQLiteDatabase): Promise<void> {
    try {
      if (this.useFTS) {
        const c = await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM mem_fts`);
        if (c && c.n > MAX_MEM) {
          const cut = await db.getFirstAsync<{ ts: number }>(
            `SELECT ts FROM mem_fts ORDER BY ts ASC LIMIT 1 OFFSET ?`,
            [MAX_MEM]
          );
          if (cut) await db.runAsync(`DELETE FROM mem_fts WHERE ts <= ?`, [cut.ts]);
        }
      }
    } catch (e) {
      console.warn('[MemoryStore] trim failed:', e);
    }
  }
}
