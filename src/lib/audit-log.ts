import { execute, genId } from './db';
import { NextRequest } from 'next/server';

interface AuditLogParams {
  userId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  req?: NextRequest;
  status?: 'success' | 'failure';
  errorMessage?: string;
}

export async function createAuditLog(params: AuditLogParams): Promise<void> {
  try {
    await execute(
      `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, 
       ip_address, user_agent, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        genId(),
        params.userId,
        params.action,
        params.resourceType ?? null,
        params.resourceId ?? null,
        params.details ? JSON.stringify(params.details) : null,
        params.req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        params.req?.headers.get('user-agent') ?? null,
        params.status ?? 'success',
        params.errorMessage ?? null,
      ]
    );
  } catch (error: any) {
    console.error('Failed to create audit log:', error.message);
  }
}
