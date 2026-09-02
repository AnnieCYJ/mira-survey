import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DEFAULT_TOOLS,
  INITIAL_TASKS,
  PLAN_PER_DAY,
  TODAY_DAY,
  CAL_MONTH,
  type TaskItem,
  type TaskType,
} from '../data/tasks';
import { RingBle } from '../ble/RingBleManager';

export interface CelebrationState {
  visible: boolean;
  title?: string;
  subtitle?: string;
  footer?: string;
  kind?: 'task' | 'monthly';
  /** 任务级庆祝时，卡片飞向的日期格子 */
  targetDay?: number;
}

interface AppStateValue {
  tasks: Record<number, TaskType[]>;
  tools: TaskItem[];
  pending: TaskItem | null;
  celebration: CelebrationState;
  addToolTask: (t: TaskItem) => boolean;
  completeTask: (id: string) => void;
  clearPending: () => void;
  triggerCelebration: (payload: Omit<CelebrationState, 'visible'>) => void;
  dismissCelebration: () => void;
  /** 基础指标自动监测总开关：设置页开启 → 洞察页基础指标卡片展示全天趋势 */
  autoMonitor: boolean;
  setAutoMonitor: (v: boolean) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Record<number, TaskType[]>>(INITIAL_TASKS);
  const [tools, setTools] = useState<TaskItem[]>(DEFAULT_TOOLS);
  const [pending, setPending] = useState<TaskItem | null>(null);
  const [celebration, setCelebration] = useState<CelebrationState>({
    visible: false,
  });
  const [autoMonitor, setAutoMonitorState] = useState(false);
  // 开关同时下发到原生桥：无论当前停在哪个页面，拨动「自动监测」都能可靠启动/停止戒指实时采集。
  // 之前只靠洞察页的 effect 在挂载时转发，若用户没进过洞察页，原生 monitorOn 永远是 false，数据不流。
  const setAutoMonitor = useCallback((v: boolean) => {
    setAutoMonitorState(v);
    RingBle.setAutoMonitor(v);
  }, []);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;

  const addToolTask = useCallback((t: TaskItem) => {
    const exists = toolsRef.current.some((x) => x.title === t.title);
    if (exists) return false;
    setTools((prev) => [t, ...prev]);
    return true;
  }, []);

  const triggerCelebration = useCallback((payload: Omit<CelebrationState, 'visible'>) => {
    setCelebration({ visible: true, ...payload });
  }, []);

  const completeTask = useCallback((id: string) => {
    const target = toolsRef.current.find((t) => t.id === id);
    if (!target || target.done) return;

    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, done: true } : t)));
    setTasks((prev) => {
      const cur = prev[TODAY_DAY] ?? [];
      if (cur.includes(target.type)) return prev;
      return { ...prev, [TODAY_DAY]: [...cur, target.type] };
    });
    setPending({ ...target, done: true });
    triggerCelebration({
      title: '任务已完成',
      subtitle: target.title,
      footer: `已记录到 ${CAL_MONTH + 1}月${TODAY_DAY}日 · 第 ${TODAY_DAY} 天`,
      kind: 'task',
      targetDay: TODAY_DAY,
    });
  }, [triggerCelebration]);

  const clearPending = useCallback(() => setPending(null), []);

  const dismissCelebration = useCallback(() => {
    setCelebration((prev) => ({ ...prev, visible: false }));
  }, []);

  const value = useMemo(
    () => ({
      tasks,
      tools,
      pending,
      celebration,
      addToolTask,
      completeTask,
      clearPending,
      triggerCelebration,
      dismissCelebration,
      autoMonitor,
      setAutoMonitor,
    }),
    [
      tasks,
      tools,
      pending,
      celebration,
      addToolTask,
      completeTask,
      clearPending,
      triggerCelebration,
      dismissCelebration,
      autoMonitor,
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}

export { PLAN_PER_DAY, TODAY_DAY };
