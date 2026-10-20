import { sqliteTable, integer, text, index, check, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Authentication and journal snapshots belong to the signed-in Site owner.
export const admin = sqliteTable('admin', {
  id: integer('id').primaryKey(),
  owner: text('owner').notNull(),
  username: text('username').notNull(),
  salt: text('salt').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [check('singleton_admin', sql`${t.id} = 1`)]);
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  owner: text('owner').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, t => [index('sessions_expiry').on(t.expiresAt)]);
export const attempts = sqliteTable('auth_attempts', {
  identity: text('identity').primaryKey(),
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull(),
});

export const accountJournals = sqliteTable('account_journals', {
  owner: text('owner').notNull(),
  adminId: integer('admin_id').notNull().references(() => admin.id),
  json: text('json').notNull(),
  revision: integer('revision').notNull(),
  previousJson: text('previous_json'),
  previousRevision: integer('previous_revision'),
  updatedAt: integer('updated_at').notNull(),
}, t => [
  primaryKey({columns: [t.owner, t.adminId]}),
  check('journal_revision', sql`${t.revision} >= 1 AND ${t.revision} <= 9007199254740991`),
  check('journal_backup', sql`(${t.previousJson} IS NULL AND ${t.previousRevision} IS NULL) OR (${t.previousJson} IS NOT NULL AND ${t.previousRevision} IS NOT NULL AND ${t.previousRevision} >= 1 AND ${t.previousRevision} < ${t.revision})`),
]);
