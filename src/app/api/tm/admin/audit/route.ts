import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { intParam, requirePermission, searchParams, toErrorResponse } from '@/lib/api';

export async function GET(req: Request) {
  try {
    await requirePermission('tm.audit.view');
    const sp = searchParams(req);

    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    const action = sp.get('action');
    if (action && action !== 'ALL') {
      where.push('a.action LIKE ?');
      params.push(`%${action}%`);
    }
    const entity = sp.get('entity_type');
    if (entity && entity !== 'ALL') {
      where.push('a.entity_type = ?');
      params.push(entity);
    }
    const userId = sp.get('user_id');
    if (userId) {
      where.push('a.user_id = ?');
      params.push(Number(userId));
    }

    const limit = intParam(sp, 'limit', 100, 500);
    const page = intParam(sp, 'page', 1);

    const [rows, total, aiUsage] = await Promise.all([
      query(
        `SELECT a.*, u.full_name, u.avatar_url, u.role
           FROM tm_audit_logs a LEFT JOIN tm_users u ON u.id = a.user_id
          WHERE ${where.join(' AND ')}
          ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit],
      ),
      queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM tm_audit_logs a WHERE ${where.join(' AND ')}`, params),
      query(
        `SELECT feature, COUNT(*) AS calls, SUM(success) AS ok,
                SUM(COALESCE(tokens_in,0)) AS tokens_in, SUM(COALESCE(tokens_out,0)) AS tokens_out
           FROM tm_ai_usage_logs
          WHERE created_at >= (NOW() - INTERVAL 30 DAY)
          GROUP BY feature ORDER BY calls DESC`,
      ),
    ]);

    return NextResponse.json({
      logs: rows,
      total: Number(total?.c ?? 0),
      page,
      ai_usage: aiUsage,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
