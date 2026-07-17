import { pgTable, serial, varchar, timestamp, boolean, integer, text, jsonb, index, unique } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 激活码表
export const activationCodes = pgTable(
	"activation_codes",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		code: varchar("code", { length: 32 }).notNull().unique(),
		name: varchar("name", { length: 128 }),
		description: text("description"),
		max_uses: integer("max_uses").default(1),
		used_count: integer("used_count").default(0).notNull(),
		is_active: boolean("is_active").default(true).notNull(),
		expires_at: timestamp("expires_at", { withTimezone: true }),
		credit_amount: integer("credit_amount").default(100),
		tool_id: varchar("tool_id", { length: 36 }),
		tool_ids: text("tool_ids"),  // 逗号分隔的工具ID列表，NULL=全部工具
		batch_id: varchar("batch_id", { length: 36 }),
		duration_type: varchar("duration_type", { length: 16 }),  // 用户激活有效期: 1day/7days/month/year/permanent
		grant_membership: integer("grant_membership").default(0).notNull(),  // 1=激活时授予会员身份
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true }),
	},
	(table) => [
		index("activation_codes_code_idx").on(table.code),
		index("activation_codes_is_active_idx").on(table.is_active),
		index("idx_activation_codes_tool_id").on(table.tool_id),
		index("idx_activation_codes_tool_ids").on(table.tool_ids),
		index("idx_activation_codes_batch_id").on(table.batch_id),
	]
);

// 工作流/智能体配置表
export const workflowConfigs = pgTable(
	"workflow_configs",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		coze_id: varchar("coze_id", { length: 128 }).notNull(),
		name: varchar("name", { length: 128 }).notNull(),
		description: text("description"),
		type: varchar("type", { length: 32 }).default("workflow").notNull(),
		category: varchar("category", { length: 64 }).default("").notNull(),
		icon_url: text("icon_url"),
		is_enabled: boolean("is_enabled").default(true).notNull(),
		credit_cost: integer("credit_cost").default(1).notNull(),
		parameters_schema: jsonb("parameters_schema"),
		tutorial: text("tutorial"),  // 使用教程（HTML/纯文本，支持链接）
		opening_statement: text("opening_statement"),  // Bot 开场白（数据库配置，优先于 Coze API）
		suggested_questions: jsonb("suggested_questions"),  // Bot 推荐问题（JSON 数组，数据库配置优先于 Coze API）
		sort_order: integer("sort_order").default(0).notNull(),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true }),
	},
	(table) => [
		index("workflow_configs_type_idx").on(table.type),
		index("workflow_configs_is_enabled_idx").on(table.is_enabled),
	]
);

// 用户常用工具收藏表
export const userFavorites = pgTable(
	"user_favorites",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		user_id: varchar("user_id", { length: 36 }).notNull(),
		tool_id: varchar("tool_id", { length: 36 }).notNull().references(() => workflowConfigs.id, { onDelete: "cascade" }),
		sort_order: integer("sort_order").default(0).notNull(),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("user_favorites_user_id_idx").on(table.user_id),
		index("user_favorites_tool_id_idx").on(table.tool_id),
	]
);

// 用户积分余额表
export const userCredits = pgTable(
	"user_credits",
	{
		user_id: varchar("user_id", { length: 36 }).primaryKey(),
		balance: integer("balance").default(0).notNull(),
		total_granted: integer("total_granted").default(0).notNull(),
		total_consumed: integer("total_consumed").default(0).notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	}
);

// 积分流水表
export const creditTransactions = pgTable(
	"credit_transactions",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		user_id: varchar("user_id", { length: 36 }).notNull(),
		amount: integer("amount").notNull(),
		type: varchar("type", { length: 32 }).notNull(),
		workflow_config_id: varchar("workflow_config_id", { length: 36 }).references(() => workflowConfigs.id),
		description: text("description"),
		idempotency_key: varchar("idempotency_key", { length: 64 }),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("credit_transactions_user_id_idx").on(table.user_id),
		index("credit_transactions_type_idx").on(table.type),
		index("credit_transactions_created_at_idx").on(table.created_at),
		index("credit_transactions_idempotency_key_idx").on(table.idempotency_key),
		unique("credit_transactions_idempotency_key_uniq").on(table.idempotency_key),
	]
);

// 用户激活记录表
export const userActivations = pgTable(
	"user_activations",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		user_id: varchar("user_id", { length: 36 }).notNull(),
		activation_code_id: varchar("activation_code_id", { length: 36 }).notNull().references(() => activationCodes.id),
		activated_at: timestamp("activated_at", { withTimezone: true }).defaultNow().notNull(),
		expires_at: timestamp("expires_at", { withTimezone: true }),
		is_active: boolean("is_active").default(true).notNull(),
		tool_id: varchar("tool_id", { length: 36 }),
		referrer_user_id: varchar("referrer_user_id", { length: 36 }),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("user_activations_user_id_idx").on(table.user_id),
		index("user_activations_activation_code_id_idx").on(table.activation_code_id),
		index("user_activations_is_active_idx").on(table.is_active),
		index("idx_user_activations_user_tool").on(table.user_id, table.tool_id),
		index("idx_user_activations_referrer").on(table.referrer_user_id),
	]
);

// 会员表：记录用户是否为会员
export const userMemberships = pgTable(
	"user_memberships",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		user_id: varchar("user_id", { length: 36 }).notNull().unique(),
		is_member: boolean("is_member").default(true).notNull(),
		activated_at: timestamp("activated_at", { withTimezone: true }).defaultNow().notNull(),
		expires_at: timestamp("expires_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true }),
	},
	(table) => [
		index("user_memberships_user_id_idx").on(table.user_id),
	]
);

// 分销关系表：记录分销层级和佣金
export const referralRelations = pgTable(
	"referral_relations",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		referrer_user_id: varchar("referrer_user_id", { length: 36 }).notNull(),  // 上级（推荐人）
		referred_user_id: varchar("referred_user_id", { length: 36 }).notNull(),   // 下级（被推荐人）
		status: varchar("status", { length: 16 }).default("active").notNull(),     // active / inactive
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("referral_relations_referrer_idx").on(table.referrer_user_id),
		index("referral_relations_referred_idx").on(table.referred_user_id),
		index("referral_relations_status_idx").on(table.status),
	]
);

// 分销佣金记录表
export const referralCommissions = pgTable(
	"referral_commissions",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		referrer_user_id: varchar("referrer_user_id", { length: 36 }).notNull(),
		referred_user_id: varchar("referred_user_id", { length: 36 }).notNull(),
		amount: integer("amount").default(0).notNull(),
		type: varchar("type", { length: 32 }).default("activation").notNull(),  // activation / consumption
		description: text("description"),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("referral_commissions_referrer_idx").on(table.referrer_user_id),
		index("referral_commissions_created_at_idx").on(table.created_at),
	]
);

// 用户 Coze OAuth Token 表（加密存储）
export const cozeTokens = pgTable(
	"coze_tokens",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		user_id: varchar("user_id", { length: 36 }).notNull(),
		encrypted_access_token: text("encrypted_access_token").notNull(),
		encrypted_refresh_token: text("encrypted_refresh_token"),
		token_expires_at: timestamp("token_expires_at", { withTimezone: true }),
		coze_user_id: varchar("coze_user_id", { length: 128 }),
		scope: text("scope"),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true }),
	},
	(table) => [
		index("coze_tokens_user_id_idx").on(table.user_id),
	]
);

// 公告表
export const announcements = pgTable(
	"announcements",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		title: varchar("title", { length: 255 }).notNull(),
		content: text("content").notNull(),
		is_pinned: integer("is_pinned").default(0).notNull(),
		is_published: integer("is_published").default(0).notNull(),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_ann_published").on(table.is_published),
		index("idx_ann_pinned").on(table.is_pinned),
	]
);

// 系统配置表（OAuth 配置等运行时可修改的配置项）
export const systemConfig = pgTable(
	"system_config",
	{
		key: varchar("key", { length: 128 }).primaryKey(),
		value: text("value").notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	}
);

// 审计日志表
export const auditLogs = pgTable(
	"audit_logs",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		user_id: varchar("user_id", { length: 36 }).notNull(),
		action: varchar("action", { length: 64 }).notNull(),
		resource_type: varchar("resource_type", { length: 64 }),
		resource_id: varchar("resource_id", { length: 128 }),
		details: jsonb("details"),
		ip_address: varchar("ip_address", { length: 45 }),
		user_agent: text("user_agent"),
		status: varchar("status", { length: 16 }).default("success").notNull(),
		error_message: text("error_message"),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("audit_logs_user_id_idx").on(table.user_id),
		index("audit_logs_action_idx").on(table.action),
		index("audit_logs_created_at_idx").on(table.created_at),
		index("audit_logs_resource_type_idx").on(table.resource_type),
	]
);

// 对话记录表
export const conversations = pgTable(
	"conversations",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		user_id: varchar("user_id", { length: 36 }).notNull(),
		tool_id: varchar("tool_id", { length: 36 }).notNull(),
		coze_conversation_id: varchar("coze_conversation_id", { length: 128 }),
		title: varchar("title", { length: 255 }),
		is_deleted: boolean("is_deleted").default(false).notNull(),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_conv_user_id").on(table.user_id),
		index("idx_conv_tool_id").on(table.tool_id),
		index("idx_conv_user_tool").on(table.user_id, table.tool_id),
	]
);

// 对话消息表
export const conversationMessages = pgTable(
	"conversation_messages",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		conversation_id: varchar("conversation_id", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
		role: varchar("role", { length: 16 }).notNull(),
		content: text("content").notNull(),
		content_type: varchar("content_type", { length: 32 }).default("text").notNull(),
		sort_order: integer("sort_order").default(0).notNull(),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("idx_msg_conversation_id").on(table.conversation_id),
		index("idx_msg_conv_sort").on(table.conversation_id, table.sort_order),
	]
);

// 限流记录表
export const rateLimits = pgTable(
	"rate_limits",
	{
		id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
		user_id: varchar("user_id", { length: 36 }).notNull(),
		action: varchar("action", { length: 64 }).notNull(),
		request_count: integer("request_count").default(1).notNull(),
		window_start: timestamp("window_start", { withTimezone: true }).defaultNow().notNull(),
		created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("rate_limits_user_action_idx").on(table.user_id, table.action),
		index("rate_limits_window_start_idx").on(table.window_start),
	]
);
