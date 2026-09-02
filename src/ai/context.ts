// 跨会话对话上下文（移植自 mira-ios/Sources/Models/ChatContextStore.swift）
// 存 chat_context：情绪/主题/健康延续，替代废弃的 persona_state。单行人设快照，load/save。

import * as SQLite from 'expo-sqlite';

export interface ChatContextSnapshot {
  moodLabel: string;
  recentThemes: string[];
  lastUserTopic: string;
  healthNote: string;
  summary: string;
  updatedAt: number;
}

const DB_NAME = 'mira_context.db';

export class ChatContextStore {
  private db: SQLite.SQLiteDatabase | null = null;
  private ready: Promise<SQLite.SQLiteDatabase> | null = null;

  open(): Promise<SQLite.SQLiteDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS chat_context (id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER);`
      );
      this.db = db;
      return db;
    })();
    return this.ready;
  }

  async load(): Promise<ChatContextSnapshot | null> {
    const db = await this.open();
    try {
      const row = await db.getFirstAsync<{ data: string }>(
        `SELECT data FROM chat_context WHERE id='current'`
      );
      if (!row) return null;
      return JSON.parse(row.data) as ChatContextSnapshot;
    } catch (e) {
      console.warn('[ChatContext] load failed:', e);
      return null;
    }
  }

  async save(snap: ChatContextSnapshot): Promise<void> {
    const db = await this.open();
    try {
      await db.runAsync(
        `INSERT OR REPLACE INTO chat_context (id, data, updated_at) VALUES ('current', ?, ?)`,
        [JSON.stringify(snap), snap.updatedAt]
      );
    } catch (e) {
      console.warn('[ChatContext] save failed:', e);
    }
  }
}
