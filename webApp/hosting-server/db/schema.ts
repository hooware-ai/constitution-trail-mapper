import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const feedbackSubmissions=sqliteTable('feedback_submissions',{
  id:text('id').primaryKey(),kind:text('kind').notNull(),message:text('message').notNull(),
  createdAt:integer('created_at').notNull(),bodyHash:text('body_hash').notNull(),counted:integer('counted').notNull().default(0)
},table=>[index('feedback_created').on(table.createdAt)]);
export const submissionLimits=sqliteTable('submission_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),expiresAt:integer('expires_at').notNull()},table=>[index('limits_expiry').on(table.expiresAt)]);

