import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import type { EarnTask, TaskCompletion } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    const admin = createAdminSupabaseClient();

    const [tasksRes, completionsRes] = await Promise.all([
      admin
        .from('earn_tasks')
        .select('*')
        .eq('is_active', true)
        .order('reward_pen', { ascending: false })
        .returns<EarnTask[]>(),
      userId
        ? admin
            .from('task_completions')
            .select('*')
            .eq('user_id', userId)
            .returns<TaskCompletion[]>()
        : Promise.resolve({ data: [] }),
    ]);

    const completedIds = new Set(
      (completionsRes.data ?? []).map((c: TaskCompletion) => c.task_id),
    );

    const totalEarned = (completionsRes.data ?? []).reduce(
      (sum: number, c: TaskCompletion) => sum + (c.reward_paid ?? 0),
      0,
    );

    const tasks = (tasksRes.data ?? []).map((t) => ({
      ...t,
      completed: completedIds.has(t.id),
    }));

    return NextResponse.json({ success: true, data: { tasks, total_earned: totalEarned } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
