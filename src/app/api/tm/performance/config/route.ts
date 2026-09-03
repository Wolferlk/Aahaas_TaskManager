import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { audit, badRequest, parseBody, requirePermission, toErrorResponse } from '@/lib/api';
import { weightsSchema } from '@/lib/validation';
import { DIMENSION_LABEL, getWeights } from '@/lib/performance';

export async function GET() {
  try {
    await requirePermission('tm.performance.view_self');
    return NextResponse.json({ weights: await getWeights(), labels: DIMENSION_LABEL });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requirePermission('tm.performance.configure');
    const weights = await parseBody(req, weightsSchema);

    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    if (Math.round(total) !== 100) {
      throw badRequest(`Weights must add up to 100. They currently total ${Math.round(total)}.`);
    }

    const before = await getWeights();
    await execute(
      `INSERT INTO tm_settings (setting_key, value, updated_by) VALUES ('performance_weights', CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
      [JSON.stringify(weights), user.id],
    );
    await audit(user.id, 'PERFORMANCE_WEIGHTS_CHANGED', 'SETTING', null, before, weights);

    return NextResponse.json({ ok: true, weights });
  } catch (err) {
    return toErrorResponse(err);
  }
}
